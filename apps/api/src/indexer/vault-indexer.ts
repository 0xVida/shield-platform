import type { ShieldVaultClient } from "@workspace/sdk/chain"
import type { Logger } from "pino"

import type { IndexerState, VaultEventStore } from "../db/vault-events"

/** Where the indexer reads events from: a ShieldVaultClient, or a fake in tests. */
export type VaultEventSource = Pick<
  ShieldVaultClient,
  "getEvents" | "getLedgerRange"
>

export interface VaultIndexerOptions {
  contractId: string
  source: VaultEventSource
  store: VaultEventStore
  logger: Logger
  /** Ledger to start from the first time. Default: the oldest the RPC still has. */
  startLedger?: number
  /** Wait between polls once caught up. Default 5000 ms, about one ledger. */
  pollIntervalMs?: number
  /** Events asked for per getEvents call. Default 100. */
  pageSize?: number
}

/**
 * Copies one vault's events into a VaultEventStore and keeps them up to date.
 *
 * Restart-safe: the position is saved after the events it covers, and saving an
 * event twice is a no-op, so a crash between the two only means re-reading a page.
 * Runs one instance per vault; two would only duplicate work.
 */
export class VaultIndexer {
  private stopped = true
  private timer: ReturnType<typeof setTimeout> | undefined
  private running: Promise<void> | undefined

  constructor(private readonly options: VaultIndexerOptions) {}

  /** Reads every new event, page by page, until caught up. Returns how many it saved. */
  async poll(): Promise<number> {
    const { contractId, source, store, logger, pageSize = 100 } = this.options
    const range = await source.getLedgerRange()
    let state = await store.state(contractId)
    const next = state
      ? state.ledger + 1
      : (this.options.startLedger ?? range.oldestLedger)
    if (next > range.latestLedger) return 0

    let start: { ledger: number } | { cursor: string }
    if (next < range.oldestLedger) {
      // The RPC dropped these ledgers before we read them. Record the loss, then go on
      // from what's left rather than stall: later events still matter.
      const gap = {
        fromLedger: next,
        toLedger: range.oldestLedger - 1,
        detectedAt: new Date(),
      }
      logger.error(
        { contractId, ...gap },
        "vault events lost: the RPC no longer has these ledgers"
      )
      state = {
        contractId,
        cursor: "",
        ledger: range.oldestLedger - 1,
        gaps: [...(state?.gaps ?? []), gap],
      }
      await store.saveState(state)
      start = { ledger: range.oldestLedger }
    } else if (state?.cursor) {
      start = { cursor: state.cursor }
    } else {
      start = { ledger: next }
    }

    let saved = 0
    for (;;) {
      const page = await source.getEvents(start, pageSize)
      await store.save(page.events)
      saved += page.events.length

      const caughtUp = page.received < pageSize
      // After a full page, the last event's ledger may hold more events not read yet
      const lastEvent = page.events.at(-1)
      state = {
        contractId,
        cursor: page.cursor,
        ledger: caughtUp
          ? page.latestLedger
          : Math.max(state?.ledger ?? 0, (lastEvent?.ledger ?? next) - 1),
        gaps: state?.gaps ?? [],
      }
      await store.saveState(state)
      if (caughtUp) return saved
      start = { cursor: page.cursor }
    }
  }

  /** Polls now, then again every pollIntervalMs. Errors are logged and retried. */
  start(): void {
    if (!this.stopped) return
    this.stopped = false
    const { contractId, logger, pollIntervalMs = 5000 } = this.options

    const tick = async () => {
      try {
        const saved = await this.poll()
        if (saved > 0)
          logger.info({ contractId, saved }, "vault events indexed")
      } catch (err) {
        logger.warn(
          { err, contractId },
          "vault indexer poll failed; will retry"
        )
      }
      if (!this.stopped) {
        this.timer = setTimeout(() => {
          this.running = tick()
        }, pollIntervalMs)
      }
    }
    this.running = tick()
  }

  /** Stops polling, waiting for a poll in progress to finish. */
  async stop(): Promise<void> {
    this.stopped = true
    clearTimeout(this.timer)
    await this.running
  }
}

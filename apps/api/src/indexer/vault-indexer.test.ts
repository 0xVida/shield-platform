import { describe, expect, test } from "bun:test"
import type { VaultEvent, VaultEventPage } from "@workspace/sdk/chain"
import type { Logger } from "pino"

import { MemoryVaultEventStore } from "../db/memory-vault-events"
import { VaultIndexer, type VaultEventSource } from "./vault-indexer"

const VAULT = "CB6RKTUOZVQKEKFMJFIKVM4C7JS7VRVDYK3IBQSW5GKBOSOEYXVZMFRK"

function funded(id: string, ledger: number): VaultEvent {
  return {
    type: "funded",
    id,
    contractId: VAULT,
    ledger,
    ledgerClosedAt: "2026-10-30T23:42:35Z",
    txHash: `tx-${id}`,
    batchId: 1n,
    funder: "GFUNDER",
    token: "CTOKEN",
    root: 123n,
    total: 1000n,
  }
}

function withdrawn(id: string, ledger: number, nullifier: bigint): VaultEvent {
  return {
    type: "withdrawn",
    id,
    contractId: VAULT,
    ledger,
    ledgerClosedAt: "2026-10-30T23:42:45Z",
    txHash: `tx-${id}`,
    batchId: 1n,
    nullifier,
    recipient: "GRECIPIENT",
    amount: 250n,
  }
}

/** A fake RPC: a fixed ledger range, and scripted pages served in order. */
function fakeSource(
  range: { oldestLedger: number; latestLedger: number },
  pages: Partial<VaultEventPage>[]
) {
  const calls: Parameters<VaultEventSource["getEvents"]>[] = []
  let served = 0
  const source: VaultEventSource = {
    getLedgerRange: async () => range,
    getEvents: async (...args) => {
      calls.push(args)
      const page = pages[Math.min(served++, pages.length - 1)] ?? {}
      const events = page.events ?? []
      return {
        events,
        received: page.received ?? events.length,
        cursor: page.cursor ?? `cursor-${served}`,
        latestLedger: page.latestLedger ?? range.latestLedger,
        oldestLedger: range.oldestLedger,
      }
    },
  }
  return { source, calls }
}

function fakeLogger() {
  const logged: { level: string; obj: unknown; msg: string }[] = []
  const at = (level: string) => (obj: unknown, msg: string) =>
    logged.push({ level, obj, msg })
  const logger = { error: at("error"), warn: at("warn"), info: at("info") }
  return { logger: logger as unknown as Logger, logged }
}

function indexer(
  source: VaultEventSource,
  store = new MemoryVaultEventStore(),
  options: { startLedger?: number; pageSize?: number } = {}
) {
  const { logger, logged } = fakeLogger()
  const vaultIndexer = new VaultIndexer({
    contractId: VAULT,
    source,
    store,
    logger,
    pollIntervalMs: 1,
    ...options,
  })
  return { vaultIndexer, store, logged }
}

describe("VaultIndexer.poll", () => {
  test("starts at the oldest ledger the RPC has, and saves its position", async () => {
    const { source, calls } = fakeSource(
      { oldestLedger: 500, latestLedger: 900 },
      [{ events: [funded("e1", 600)], cursor: "c1" }]
    )
    const { vaultIndexer, store } = indexer(source)

    expect(await vaultIndexer.poll()).toBe(1)
    expect(calls).toEqual([[{ ledger: 500 }, 100]])
    expect(store.states.get(VAULT)).toEqual({
      contractId: VAULT,
      cursor: "c1",
      ledger: 900,
      gaps: [],
    })
  })

  test("starts at startLedger the first time, when it's set", async () => {
    const { source, calls } = fakeSource(
      { oldestLedger: 500, latestLedger: 900 },
      [{}]
    )
    await indexer(source, undefined, { startLedger: 700 }).vaultIndexer.poll()
    expect(calls[0]?.[0]).toEqual({ ledger: 700 })
  })

  test("resumes from the saved cursor once a new ledger has closed", async () => {
    const range = { oldestLedger: 500, latestLedger: 900 }
    const { source, calls } = fakeSource(range, [
      { cursor: "c1" },
      { cursor: "c2" },
    ])
    const { vaultIndexer } = indexer(source)
    await vaultIndexer.poll()
    range.latestLedger = 905
    await vaultIndexer.poll()
    expect(calls.map(([start]) => start)).toEqual([
      { ledger: 500 },
      { cursor: "c1" },
    ])
  })

  test("reads page after page until it's caught up", async () => {
    const { source, calls } = fakeSource(
      { oldestLedger: 500, latestLedger: 900 },
      [
        { events: [funded("e1", 600), withdrawn("e2", 610, 7n)], cursor: "c1" },
        { events: [withdrawn("e3", 620, 8n)], cursor: "c2" },
      ]
    )
    const { vaultIndexer, store } = indexer(source, undefined, { pageSize: 2 })

    expect(await vaultIndexer.poll()).toBe(3)
    expect(calls.map(([start]) => start)).toEqual([
      { ledger: 500 },
      { cursor: "c1" },
    ])
    expect(store.events.size).toBe(3)
    expect(store.states.get(VAULT)?.cursor).toBe("c2")
  })

  test("keeps paging past a full page of events it doesn't know", async () => {
    const { source, calls } = fakeSource(
      { oldestLedger: 500, latestLedger: 900 },
      [
        { events: [], received: 2, cursor: "c1" },
        { events: [funded("e1", 650)], cursor: "c2" },
      ]
    )
    const { vaultIndexer, store } = indexer(source, undefined, { pageSize: 2 })
    await vaultIndexer.poll()
    expect(calls).toHaveLength(2)
    expect(store.events.size).toBe(1)
  })

  test("saves each event and nullifier once, even when a page is read twice", async () => {
    const page = { events: [funded("e1", 600), withdrawn("e2", 610, 7n)] }
    const { source } = fakeSource({ oldestLedger: 500, latestLedger: 900 }, [
      page,
      page,
    ])
    const { vaultIndexer, store } = indexer(source)
    await vaultIndexer.poll()
    await vaultIndexer.poll()

    expect(store.events.size).toBe(2)
    expect([...store.nullifiers]).toEqual([`${VAULT}/1/7`])
  })

  test("records a gap when the RPC dropped ledgers it hadn't read yet", async () => {
    const { source, calls } = fakeSource(
      { oldestLedger: 500, latestLedger: 900 },
      [{}]
    )
    const store = new MemoryVaultEventStore()
    await store.saveState({
      contractId: VAULT,
      cursor: "old",
      ledger: 100,
      gaps: [],
    })
    const { vaultIndexer, logged } = indexer(source, store)

    await vaultIndexer.poll()
    expect(calls[0]?.[0]).toEqual({ ledger: 500 })
    expect(store.states.get(VAULT)?.gaps).toMatchObject([
      { fromLedger: 101, toLedger: 499 },
    ])
    expect(logged.some((l) => l.level === "error")).toBe(true)
  })

  test("records a gap when startLedger is older than the RPC's oldest", async () => {
    const { source } = fakeSource({ oldestLedger: 500, latestLedger: 900 }, [
      {},
    ])
    const { vaultIndexer, store } = indexer(source, undefined, {
      startLedger: 1,
    })
    await vaultIndexer.poll()
    expect(store.states.get(VAULT)?.gaps).toMatchObject([
      { fromLedger: 1, toLedger: 499 },
    ])
  })

  test("asks for nothing when no new ledger has closed", async () => {
    const { source, calls } = fakeSource(
      { oldestLedger: 500, latestLedger: 900 },
      []
    )
    const store = new MemoryVaultEventStore()
    await store.saveState({
      contractId: VAULT,
      cursor: "c",
      ledger: 900,
      gaps: [],
    })
    expect(await indexer(source, store).vaultIndexer.poll()).toBe(0)
    expect(calls).toHaveLength(0)
  })
})

describe("VaultIndexer.start", () => {
  test("logs a failed poll and tries again", async () => {
    let attempts = 0
    const { source } = fakeSource({ oldestLedger: 500, latestLedger: 900 }, [
      { events: [funded("e1", 600)] },
    ])
    const flaky: VaultEventSource = {
      ...source,
      getLedgerRange: async () => {
        if (++attempts === 1) throw new Error("RPC unreachable")
        return source.getLedgerRange()
      },
    }
    const { vaultIndexer, store, logged } = indexer(flaky)

    vaultIndexer.start()
    for (let i = 0; i < 100 && store.events.size === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    await vaultIndexer.stop()

    expect(logged.some((l) => l.level === "warn")).toBe(true)
    expect(store.events.size).toBe(1)
  })

  test("stop() ends polling", async () => {
    const { source, calls } = fakeSource(
      { oldestLedger: 500, latestLedger: 900 },
      [{}]
    )
    const { vaultIndexer } = indexer(source)
    vaultIndexer.start()
    await vaultIndexer.stop()
    const afterStop = calls.length
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(calls.length).toBe(afterStop)
  })
})

import type { VaultEvent } from "@workspace/sdk/chain"

import type { IndexerState, VaultEventStore } from "./vault-events"

/** VaultEventStore in memory, for tests. */
export class MemoryVaultEventStore implements VaultEventStore {
  /** Saved events, by `${contractId}/${id}`. */
  readonly events = new Map<string, VaultEvent>()
  /** Spent nullifiers, as `${contractId}/${batchId}/${nullifier}`. */
  readonly nullifiers = new Set<string>()
  readonly states = new Map<string, IndexerState>()

  async save(events: VaultEvent[]): Promise<void> {
    for (const event of events) {
      const key = `${event.contractId}/${event.id}`
      if (!this.events.has(key)) this.events.set(key, event)
      if (event.type === "withdrawn") {
        this.nullifiers.add(
          `${event.contractId}/${event.batchId}/${event.nullifier}`
        )
      }
    }
  }

  async state(contractId: string): Promise<IndexerState | undefined> {
    return this.states.get(contractId)
  }

  async saveState(state: IndexerState): Promise<void> {
    this.states.set(state.contractId, structuredClone(state))
  }
}

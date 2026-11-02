import type { VaultEvent } from "@workspace/sdk/chain"

import type {
  ActivityQuery,
  IndexerState,
  VaultEventStore,
} from "./vault-events"

/** VaultEventStore in memory, for tests. */
export class MemoryVaultEventStore implements VaultEventStore {
  /** Saved events, by `${contractId}/${id}`. */
  readonly events = new Map<string, VaultEvent>()
  readonly states = new Map<string, IndexerState>()

  async save(events: VaultEvent[]): Promise<void> {
    for (const event of events) {
      const key = `${event.contractId}/${event.id}`
      if (!this.events.has(key)) this.events.set(key, event)
    }
  }

  async list(query: ActivityQuery): Promise<VaultEvent[]> {
    return [...this.events.values()]
      .filter(
        (event) =>
          event.contractId === query.contractId &&
          (query.batchId === undefined || event.batchId === query.batchId) &&
          (query.type === undefined || event.type === query.type) &&
          (query.before === undefined || event.id < query.before) &&
          (query.address === undefined ||
            event.funder === query.address ||
            (event.type === "withdrawn" && event.recipient === query.address))
      )
      .sort((a, b) => (a.id < b.id ? 1 : -1))
      .slice(0, query.limit)
  }

  async byTx(contractId: string, txHash: string): Promise<VaultEvent[]> {
    return [...this.events.values()]
      .filter((e) => e.contractId === contractId && e.txHash === txHash)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
  }

  async state(contractId: string): Promise<IndexerState | undefined> {
    return this.states.get(contractId)
  }

  async saveState(state: IndexerState): Promise<void> {
    this.states.set(state.contractId, structuredClone(state))
  }
}

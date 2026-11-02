import {
  BatchIdTakenError,
  definedFields,
  type AllocationRecord,
  type BatchRecord,
  type BatchStatus,
  type BatchStore,
  type StatusFields,
} from "./batches"

/** BatchStore in memory, for tests. */
export class MemoryBatchStore implements BatchStore {
  readonly batches = new Map<bigint, BatchRecord>()
  readonly allocationsByBatch = new Map<bigint, AllocationRecord[]>()

  async create(
    batch: BatchRecord,
    allocations: AllocationRecord[]
  ): Promise<void> {
    if (this.batches.has(batch.batchId)) {
      throw new BatchIdTakenError(batch.batchId)
    }
    this.batches.set(batch.batchId, batch)
    this.allocationsByBatch.set(batch.batchId, allocations)
  }

  async get(batchId: bigint): Promise<BatchRecord | undefined> {
    return this.batches.get(batchId)
  }

  async list(limit: number, status?: BatchStatus): Promise<BatchRecord[]> {
    return [...this.batches.values()]
      .filter((b) => status === undefined || b.status === status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
  }

  async allocations(batchId: bigint): Promise<AllocationRecord[]> {
    return this.allocationsByBatch.get(batchId) ?? []
  }

  async allocationByRecipient(
    batchId: bigint,
    recipient: string
  ): Promise<AllocationRecord | undefined> {
    return this.allocationsByBatch
      .get(batchId)
      ?.find((a) => a.recipient === recipient)
  }

  async allocationByToken(
    token: string
  ): Promise<AllocationRecord | undefined> {
    for (const allocs of this.allocationsByBatch.values()) {
      const match = allocs.find((a) => a.claimToken === token)
      if (match) return match
    }
    return undefined
  }

  async setStatus(
    batchId: bigint,
    from: BatchStatus,
    to: BatchStatus,
    fields: StatusFields = {}
  ): Promise<boolean> {
    const batch = this.batches.get(batchId)
    if (batch?.status !== from) return false
    const { error: _, ...rest } = batch
    this.batches.set(batchId, { ...rest, status: to, ...definedFields(fields) })
    return true
  }

  async withStatus(status: BatchStatus): Promise<BatchRecord[]> {
    return [...this.batches.values()].filter((b) => b.status === status)
  }
}

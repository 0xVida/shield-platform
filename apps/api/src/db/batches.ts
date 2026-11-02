import type { ClaimData } from "@workspace/sdk"
import {
  MongoBulkWriteError,
  MongoServerError,
  type Collection,
  type Db,
} from "mongodb"

import { decrypt, encrypt, type Encrypted } from "../lib/encryption"
import { jsonReplacer } from "../lib/json"

/**
 * Where a batch is in the end-to-end flow: created, then its conservation proof is
 * generated (proving, then proved; or failed, and proved again), then funded once
 * the vault holds it.
 */
export const BATCH_STATUSES = [
  "created",
  "proving",
  "proved",
  "failed",
  "funded",
] as const
export type BatchStatus = (typeof BATCH_STATUSES)[number]

/** A confidential batch. Only values that end up public; allocations are separate. */
export type BatchRecord = {
  batchId: bigint
  name: string | null
  status: BatchStatus
  /** Merkle root of the allocation commitments: `root` in fund_batch. */
  root: bigint
  /** Sum of the allocations: `total` in fund_batch. */
  total: bigint
  /** Tree depth the batch was built with. */
  depth: number
  recipientCount: number
  createdAt: Date
  /** The conservation proof as hex, in the 256-byte encoding fund_batch takes. */
  proof?: string
  /** Why the last proof failed. Never holds claim data. */
  error?: string
  /** Who paid for the batch, as reported with the funding transaction. */
  funder?: string
  /** Token contract the vault holds the batch in. */
  token?: string
  /** Hash of the fund_batch transaction, as reported. */
  fundingTx?: string
  /** When the vault was confirmed to hold the batch. */
  fundedAt?: Date
}

/** Fields that change with a batch's status. */
export type StatusFields = Partial<
  Pick<
    BatchRecord,
    "proof" | "error" | "funder" | "token" | "fundingTx" | "fundedAt"
  >
>

/** One recipient's allocation. The claim data is encrypted: it holds their secret. */
export type AllocationRecord = {
  batchId: bigint
  leafIndex: number
  /** The disburser's reference for the recipient, e.g. an SDP receiver id. */
  recipient: string
  claim: Encrypted
  /** Random, single-use bearer token for secure claim delivery. */
  claimToken?: string
}

/** A recipient's claim data, decrypted (architecture flow, step 4). */
export type ClaimRecord = ClaimData & { batchId: bigint }

export class BatchIdTakenError extends Error {
  override readonly name = "BatchIdTakenError"

  constructor(batchId: bigint) {
    super(`Batch id ${batchId} is already in use`)
  }
}

export interface BatchStore {
  /** Saves a new batch with its allocations. Throws BatchIdTakenError if the id is in use. */
  create(batch: BatchRecord, allocations: AllocationRecord[]): Promise<void>
  get(batchId: bigint): Promise<BatchRecord | undefined>
  /** The most recently created batches, newest first; only those in `status` if given. */
  list(limit: number, status?: BatchStatus): Promise<BatchRecord[]>
  /** A batch's allocations, in leaf order. */
  allocations(batchId: bigint): Promise<AllocationRecord[]>
  /** Looks up one recipient's allocation in a batch. */
  allocationByRecipient(
    batchId: bigint,
    recipient: string
  ): Promise<AllocationRecord | undefined>
  /** Looks up an allocation by its unguessable claim token. */
  allocationByToken(token: string): Promise<AllocationRecord | undefined>
  /**
   * Moves a batch from status `from` to `to`, setting the given fields; `error` is
   * cleared unless given. Returns false, changing nothing, if the batch isn't in
   * status `from`, so two requests can't make the same move.
   */
  setStatus(
    batchId: bigint,
    from: BatchStatus,
    to: BatchStatus,
    fields?: StatusFields
  ): Promise<boolean>
  /** Every batch in the given status. */
  withStatus(status: BatchStatus): Promise<BatchRecord[]>
}

/**
 * Encrypts a recipient's claim data for storage. The batch id and leaf index are
 * bound to the ciphertext, so claim data moved to another allocation won't decrypt.
 */
export function sealClaim(
  key: Uint8Array,
  batchId: bigint,
  claim: ClaimData
): Encrypted {
  const plaintext = JSON.stringify({ batchId, ...claim }, jsonReplacer)
  return encrypt(key, plaintext, claimContext(batchId, claim.leafIndex))
}

/** Decrypts an allocation's claim data: what its recipient needs to claim. */
export function openClaim(
  key: Uint8Array,
  allocation: AllocationRecord
): ClaimRecord {
  const { batchId, leafIndex } = allocation
  const claim = JSON.parse(
    decrypt(key, allocation.claim, claimContext(batchId, leafIndex))
  )
  return {
    batchId: BigInt(claim.batchId),
    leafIndex: claim.leafIndex,
    amount: BigInt(claim.amount),
    secret: BigInt(claim.secret),
    pathElements: claim.pathElements.map(BigInt),
    pathIndices: claim.pathIndices,
  }
}

function claimContext(batchId: bigint, leafIndex: number): string {
  return `confidential_allocations/${batchId}/${leafIndex}`
}

// u64 ids and field elements don't fit MongoDB's numbers, so they're stored as
// decimal strings.
type BatchDoc = Omit<BatchRecord, "batchId" | "root" | "total"> & {
  _id: string
  root: string
  total: string
}
type AllocationDoc = Omit<AllocationRecord, "batchId"> & { batchId: string }

/** BatchStore on the `confidential_batches` and `confidential_allocations` collections. */
export class MongoBatchStore implements BatchStore {
  private readonly batches: Collection<BatchDoc>
  private readonly allocationDocs: Collection<AllocationDoc>

  constructor(db: Db) {
    this.batches = db.collection<BatchDoc>("confidential_batches")
    this.allocationDocs = db.collection<AllocationDoc>(
      "confidential_allocations"
    )
  }

  /** Creates the indexes the store relies on. Safe to run on every boot. */
  async ensureIndexes(): Promise<void> {
    await this.batches.createIndex({ createdAt: -1 })
    await this.batches.createIndex({ status: 1 })
    // Also makes a batch id usable by one batch only: see create()
    await this.allocationDocs.createIndex(
      { batchId: 1, leafIndex: 1 },
      { unique: true }
    )
    await this.allocationDocs.createIndex({ recipient: 1 })
    await this.allocationDocs.createIndex(
      { claimToken: 1 },
      { unique: true, sparse: true }
    )
  }

  async create(
    batch: BatchRecord,
    allocations: AllocationRecord[]
  ): Promise<void> {
    // Without a transaction (the dev MongoDB isn't a replica set), the batch goes in
    // last: allocations only count once their batch exists, so a crash halfway
    // leaves unused leftovers rather than a batch with missing allocations.
    const id = batch.batchId.toString()
    if (await this.batches.countDocuments({ _id: id }, { limit: 1 })) {
      throw new BatchIdTakenError(batch.batchId)
    }
    try {
      await this.allocationDocs.insertMany(
        allocations.map((a) => ({ ...a, batchId: id }))
      )
    } catch (err) {
      // If not even the first allocation went in, the unique index says another
      // batch holds this id; nothing of ours needs removing.
      if (insertedCount(err) === 0) {
        throw isDuplicateKey(err) ? new BatchIdTakenError(batch.batchId) : err
      }
      // Our first allocation went in, so the id is ours: remove what we wrote
      await this.allocationDocs.deleteMany({ batchId: id })
      throw err
    }
    try {
      const { batchId: _, root, total, ...rest } = batch
      await this.batches.insertOne({
        _id: id,
        ...rest,
        root: root.toString(),
        total: total.toString(),
      })
    } catch (err) {
      await this.allocationDocs.deleteMany({ batchId: id })
      throw err
    }
  }

  async get(batchId: bigint): Promise<BatchRecord | undefined> {
    const doc = await this.batches.findOne({ _id: batchId.toString() })
    return doc ? fromBatchDoc(doc) : undefined
  }

  async list(limit: number, status?: BatchStatus): Promise<BatchRecord[]> {
    const docs = await this.batches
      .find(status ? { status } : {})
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray()
    return docs.map(fromBatchDoc)
  }

  async allocations(batchId: bigint): Promise<AllocationRecord[]> {
    const docs = await this.allocationDocs
      .find({ batchId: batchId.toString() }, { projection: { _id: 0 } })
      .sort({ leafIndex: 1 })
      .toArray()
    return docs.map((doc) => ({ ...doc, batchId: BigInt(doc.batchId) }))
  }

  async allocationByRecipient(
    batchId: bigint,
    recipient: string
  ): Promise<AllocationRecord | undefined> {
    const doc = await this.allocationDocs.findOne(
      { batchId: batchId.toString(), recipient },
      { projection: { _id: 0 } }
    )
    return doc ? { ...doc, batchId: BigInt(doc.batchId) } : undefined
  }

  async allocationByToken(
    token: string
  ): Promise<AllocationRecord | undefined> {
    const doc = await this.allocationDocs.findOne(
      { claimToken: token },
      { projection: { _id: 0 } }
    )
    return doc ? { ...doc, batchId: BigInt(doc.batchId) } : undefined
  }

  async setStatus(
    batchId: bigint,
    from: BatchStatus,
    to: BatchStatus,
    fields: StatusFields = {}
  ): Promise<boolean> {
    // The status in the filter makes check-and-set one atomic update
    const result = await this.batches.updateOne(
      { _id: batchId.toString(), status: from },
      {
        $set: { status: to, ...definedFields(fields) },
        ...(fields.error === undefined ? { $unset: { error: "" } } : {}),
      }
    )
    return result.matchedCount === 1
  }

  async withStatus(status: BatchStatus): Promise<BatchRecord[]> {
    const docs = await this.batches.find({ status }).toArray()
    return docs.map(fromBatchDoc)
  }
}

/** `fields` without its undefined entries, which MongoDB would store as null. */
export function definedFields(fields: StatusFields): StatusFields {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  )
}

function fromBatchDoc({ _id, root, total, ...rest }: BatchDoc): BatchRecord {
  return {
    ...rest,
    batchId: BigInt(_id),
    root: BigInt(root),
    total: BigInt(total),
  }
}

function insertedCount(err: unknown): number {
  return err instanceof MongoBulkWriteError ? err.insertedCount : 0
}

function isDuplicateKey(err: unknown): boolean {
  return err instanceof MongoServerError && err.code === 11000
}

import type { VaultEvent } from "@workspace/sdk/chain"
import {
  MongoBulkWriteError,
  type Collection,
  type Db,
  type Filter,
} from "mongodb"

/**
 * Ledgers whose events the indexer could never read: the RPC had already dropped
 * them (it keeps about a week) by the time the indexer got there.
 */
export type IndexerGap = {
  fromLedger: number
  toLedger: number
  detectedAt: Date
}

/** How far the indexer has read one vault's events. */
export type IndexerState = {
  contractId: string
  /** RPC cursor to continue from. */
  cursor: string
  /** Every event up to and including this ledger has been read. */
  ledger: number
  gaps: IndexerGap[]
}

/**
 * The vault's events as seen on-chain. Only holds what's public on-chain: claims
 * are never matched to allocations, which would record who claimed what.
 */
export interface VaultEventStore {
  /**
   * Saves events, and records each withdrawal's nullifier as spent. Events already
   * saved (the same id from the same vault) are skipped, so saving twice is safe.
   */
  save(events: VaultEvent[]): Promise<void>
  /** One vault's events, newest first, filtered and paged as `query` says. */
  list(query: ActivityQuery): Promise<VaultEvent[]>
  /** The events one transaction emitted on one vault, in order. */
  byTx(contractId: string, txHash: string): Promise<VaultEvent[]>
  state(contractId: string): Promise<IndexerState | undefined>
  saveState(state: IndexerState): Promise<void>
}

/** Which of a vault's events to list. */
export type ActivityQuery = {
  contractId: string
  batchId?: bigint
  /** Only events with this funder or recipient: Stellar addresses, public on-chain. */
  address?: string
  type?: VaultEvent["type"]
  /** Only events older than this event id, to page on from a previous list. */
  before?: string
  limit: number
}

// bigints (batch ids, field elements, amounts) are stored as decimal strings
type EventDoc = {
  _id: string
  contractId: string
  eventId: string
  type: VaultEvent["type"]
  ledger: number
  ledgerClosedAt: Date
  txHash: string
  batchId: string
} & (
  | {
      type: "funded"
      funder: string
      token: string
      root: string
      total: string
    }
  | { type: "withdrawn"; nullifier: string; recipient: string; amount: string }
)

type NullifierDoc = {
  _id: string
  contractId: string
  batchId: string
  nullifier: string
  ledger: number
  txHash: string
}

type StateDoc = Omit<IndexerState, "contractId"> & { _id: string }

/** VaultEventStore on `vault_events`, `nullifiers_seen` and `indexer_state`. */
export class MongoVaultEventStore implements VaultEventStore {
  private readonly events: Collection<EventDoc>
  private readonly nullifiers: Collection<NullifierDoc>
  private readonly states: Collection<StateDoc>

  constructor(db: Db) {
    this.events = db.collection<EventDoc>("vault_events")
    this.nullifiers = db.collection<NullifierDoc>("nullifiers_seen")
    this.states = db.collection<StateDoc>("indexer_state")
  }

  /** Creates the indexes the store relies on. Safe to run on every boot. */
  async ensureIndexes(): Promise<void> {
    await this.events.createIndex({ contractId: 1, ledger: -1 })
    await this.events.createIndex({ contractId: 1, batchId: 1 })
    await this.events.createIndex({ recipient: 1 }, { sparse: true })
    await this.events.createIndex({ funder: 1 }, { sparse: true })
    await this.events.createIndex({ txHash: 1 })
    // Event ids are zero-padded and ordered like the events, so this pages newest first
    await this.events.createIndex({ contractId: 1, eventId: -1 })
  }

  async save(events: VaultEvent[]): Promise<void> {
    if (events.length === 0) return
    await insertNew(this.events, events.map(toEventDoc))
    const withdrawals = events.filter((event) => event.type === "withdrawn")
    if (withdrawals.length > 0) {
      await insertNew(
        this.nullifiers,
        withdrawals.map((event) => ({
          _id: `${event.contractId}/${event.batchId}/${event.nullifier}`,
          contractId: event.contractId,
          batchId: event.batchId.toString(),
          nullifier: event.nullifier.toString(),
          ledger: event.ledger,
          txHash: event.txHash,
        }))
      )
    }
  }

  async list(query: ActivityQuery): Promise<VaultEvent[]> {
    const filter: Filter<EventDoc> = { contractId: query.contractId }
    if (query.batchId !== undefined) filter.batchId = query.batchId.toString()
    if (query.type) filter.type = query.type
    if (query.before) filter.eventId = { $lt: query.before }
    if (query.address) {
      filter.$or = [{ funder: query.address }, { recipient: query.address }]
    }
    const docs = await this.events
      .find(filter)
      .sort({ eventId: -1 })
      .limit(query.limit)
      .toArray()
    return docs.map(fromEventDoc)
  }

  async byTx(contractId: string, txHash: string): Promise<VaultEvent[]> {
    const docs = await this.events
      .find({ contractId, txHash })
      .sort({ eventId: 1 })
      .toArray()
    return docs.map(fromEventDoc)
  }

  async state(contractId: string): Promise<IndexerState | undefined> {
    const doc = await this.states.findOne({ _id: contractId })
    if (!doc) return undefined
    const { _id, ...state } = doc
    return { contractId: _id, ...state }
  }

  async saveState({ contractId, ...state }: IndexerState): Promise<void> {
    await this.states.replaceOne({ _id: contractId }, state, { upsert: true })
  }
}

function toEventDoc(event: VaultEvent): EventDoc {
  const base = {
    _id: `${event.contractId}/${event.id}`,
    contractId: event.contractId,
    eventId: event.id,
    ledger: event.ledger,
    ledgerClosedAt: new Date(event.ledgerClosedAt),
    txHash: event.txHash,
    batchId: event.batchId.toString(),
  }
  return event.type === "funded"
    ? {
        ...base,
        type: "funded",
        funder: event.funder,
        token: event.token,
        root: event.root.toString(),
        total: event.total.toString(),
      }
    : {
        ...base,
        type: "withdrawn",
        nullifier: event.nullifier.toString(),
        recipient: event.recipient,
        amount: event.amount.toString(),
      }
}

function fromEventDoc(doc: EventDoc): VaultEvent {
  const meta = {
    id: doc.eventId,
    contractId: doc.contractId,
    ledger: doc.ledger,
    // As the RPC writes it: whole seconds, without ".000"
    ledgerClosedAt: doc.ledgerClosedAt.toISOString().replace(".000Z", "Z"),
    txHash: doc.txHash,
    batchId: BigInt(doc.batchId),
  }
  return doc.type === "funded"
    ? {
        ...meta,
        type: "funded",
        funder: doc.funder,
        token: doc.token,
        root: BigInt(doc.root),
        total: BigInt(doc.total),
      }
    : {
        ...meta,
        type: "withdrawn",
        nullifier: BigInt(doc.nullifier),
        recipient: doc.recipient,
        amount: BigInt(doc.amount),
      }
}

/** Inserts the documents whose _id isn't stored yet; skips the others. */
async function insertNew<T extends { _id: string }>(
  collection: Collection<T>,
  docs: T[]
): Promise<void> {
  try {
    // Unordered, so one duplicate doesn't stop the rest from going in
    await collection.insertMany(docs as never, { ordered: false })
  } catch (err) {
    const duplicatesOnly =
      err instanceof MongoBulkWriteError &&
      [err.writeErrors].flat().every((e) => e.code === 11000)
    if (!duplicatesOnly) throw err
  }
}

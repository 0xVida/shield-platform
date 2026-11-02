import { StrKey } from "@stellar/stellar-sdk"
import { MAX_BATCH_ID } from "@workspace/sdk"
import type { ShieldVaultClient, VaultEvent } from "@workspace/sdk/chain"
import { Router } from "express"
import { z } from "zod"

import type { IndexerGap, VaultEventStore } from "../db/vault-events"
import { HttpError } from "../lib/http-error"
import { validated } from "../lib/validated"

/** What the routes ask the chain directly, through Person 3's client. */
export type TransactionReader = Pick<ShieldVaultClient, "getTransaction">

/** One vault's indexed events, and the chain for what isn't indexed yet. */
export type ActivitySource = {
  contractId: string
  events: VaultEventStore
  chain: TransactionReader
}

/**
 * A vault event as the API shows it. Every field is public on-chain; nothing here
 * says which allocation a claim belongs to.
 */
export type ActivityItem =
  | {
      id: string
      type: "funded"
      ledger: number
      ledgerClosedAt: string
      txHash: string
      batchId: bigint
      funder: string
      token: string
      root: bigint
      total: bigint
    }
  | {
      id: string
      type: "withdrawn"
      ledger: number
      ledgerClosedAt: string
      txHash: string
      /** The funder whose batch paid the claim. */
      funder: string
      batchId: bigint
      nullifier: bigint
      recipient: string
      amount: bigint
    }

/** GET /v1/activity: a page of items, and how complete the history is. */
export type ActivityPage = {
  items: ActivityItem[]
  /** Pass as `before` for the next page; null on the last page. */
  next: string | null
  /** Null until the indexer's first poll. Gaps are ledgers it never read. */
  indexer: { ledger: number; gaps: IndexerGap[] } | null
}

/**
 * GET /v1/tx/:hash. "confirmed" with events: an indexed vault transaction.
 * "confirmed" without events: in a ledger, but not indexed (yet) or not a vault
 * call. "not_found": pending, never sent, expired, or older than the RPC keeps.
 */
export type TransactionStatus = {
  hash: string
  status: "confirmed" | "failed" | "not_found"
  ledger?: number
  ledgerClosedAt?: string
  events: ActivityItem[]
}

const BatchId = z
  .string()
  .regex(/^\d{1,20}$/, "must be a decimal batch id")
  .transform(BigInt)
  .refine((id) => id <= MAX_BATCH_ID, "must fit in a u64")

const ActivityQuerySchema = z.object({
  batchId: BatchId.optional(),
  address: z
    .string()
    .refine(
      (a) => StrKey.isValidEd25519PublicKey(a) || StrKey.isValidContract(a),
      "must be a Stellar address (G... or C...)"
    )
    .optional(),
  type: z.enum(["funded", "withdrawn"]).optional(),
  // An event id, as the RPC writes them
  before: z
    .string()
    .regex(/^\d{19}-\d{10}$/, "must be a cursor from a previous page")
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

const TxParams = z.object({
  hash: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "must be a 64-character hex hash")
    .transform((hash) => hash.toLowerCase()),
})

/** The vault's on-chain activity. Both routes are 503 while the vault isn't set. */
export function activityRouter(source?: ActivitySource): Router {
  const router = Router()

  function configured(): ActivitySource {
    if (!source) {
      throw new HttpError(
        503,
        "chain_unavailable",
        "The vault isn't configured on this server"
      )
    }
    return source
  }

  router.get(
    "/activity",
    validated({ query: ActivityQuerySchema }, async ({ query }, _req, res) => {
      const { contractId, events } = configured()
      const { limit, ...filters } = query
      // One extra tells whether there's a next page
      const found = await events.list({
        contractId,
        ...filters,
        limit: limit + 1,
      })
      const items = found.slice(0, limit)
      const state = await events.state(contractId)
      const page: ActivityPage = {
        items: items.map(toItem),
        next: found.length > limit ? items.at(-1)!.id : null,
        indexer: state ? { ledger: state.ledger, gaps: state.gaps } : null,
      }
      res.json(page)
    })
  )

  router.get(
    "/tx/:hash",
    validated({ params: TxParams }, async ({ params }, _req, res) => {
      const { contractId, events, chain } = configured()
      const indexed = await events.byTx(contractId, params.hash)
      if (indexed.length > 0) {
        const status: TransactionStatus = {
          hash: params.hash,
          status: "confirmed",
          ledger: indexed[0]!.ledger,
          ledgerClosedAt: indexed[0]!.ledgerClosedAt,
          events: indexed.map(toItem),
        }
        res.json(status)
        return
      }

      let outcome
      try {
        outcome = await chain.getTransaction(params.hash)
      } catch {
        throw new HttpError(502, "chain_error", "Couldn't reach the RPC")
      }
      if (outcome.status === "NOT_FOUND") {
        const status: TransactionStatus = {
          hash: params.hash,
          status: "not_found",
          events: [],
        }
        res.json(status)
        return
      }
      const status: TransactionStatus = {
        hash: params.hash,
        status: outcome.status === "SUCCESS" ? "confirmed" : "failed",
        ledger: outcome.ledger,
        ledgerClosedAt: outcome.ledgerClosedAt,
        events: [],
      }
      res.json(status)
    })
  )

  return router
}

/** Copies only the public fields, so nothing added to VaultEvent leaks by accident. */
function toItem(event: VaultEvent): ActivityItem {
  const base = {
    id: event.id,
    ledger: event.ledger,
    ledgerClosedAt: event.ledgerClosedAt,
    txHash: event.txHash,
    funder: event.funder,
    batchId: event.batchId,
  }
  return event.type === "funded"
    ? {
        ...base,
        type: "funded",
        token: event.token,
        root: event.root,
        total: event.total,
      }
    : {
        ...base,
        type: "withdrawn",
        nullifier: event.nullifier,
        recipient: event.recipient,
        amount: event.amount,
      }
}

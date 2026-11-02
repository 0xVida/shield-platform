import { randomBytes } from "node:crypto"
import { StrKey } from "@stellar/stellar-sdk"
import {
  MAX_ALLOCATIONS,
  MAX_AMOUNT,
  MAX_BATCH_ID,
  buildBatch,
  generateSecret,
} from "@workspace/sdk"
import type { ShieldVaultClient, VaultBatch } from "@workspace/sdk/chain"
import { Router } from "express"
import type { Logger } from "pino"
import { z } from "zod"

import {
  BATCH_STATUSES,
  BatchIdTakenError,
  sealClaim,
  type BatchRecord,
  type BatchStore,
} from "../db/batches"
import { HttpError } from "../lib/http-error"
import { validated } from "../lib/validated"
import type { ConservationProofs } from "../proving/proofs"

/** What the API shows of a batch: never its allocations, which hold the secrets. */
export type BatchSummary = Omit<BatchRecord, "depth">

/** What the API reads from the vault, through Person 3's client. */
export type VaultReader = Pick<ShieldVaultClient, "getBatch">

/** How much of a funded batch its recipients have claimed, per the vault. */
export type ClaimProgress = { withdrawn: bigint; remaining: bigint }

/**
 * One batch, as GET /v1/batches/:batchId shows it. A funded batch also shows its
 * claim progress: null when the vault can't be read right now.
 */
export type BatchDetail = BatchSummary & { claims?: ClaimProgress | null }

const BatchId = z
  .string()
  .regex(/^\d{1,20}$/, "must be a decimal batch id")
  .transform(BigInt)
  .refine((id) => id <= MAX_BATCH_ID, "must fit in a u64")

const AllocationInput = z.object({
  /** The disburser's reference for the recipient, e.g. an SDP receiver id. */
  recipient: z.string().trim().min(1).max(256),
  // A string, not a JSON number: amounts go past 2^53.
  amount: z
    .string()
    .regex(/^[1-9]\d{0,19}$/, "must be a positive whole number of base units")
    .transform(BigInt)
    .refine((amount) => amount <= MAX_AMOUNT, "must fit in 64 bits"),
})

const CreateBatchBody = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    allocations: z.array(AllocationInput).min(1).max(MAX_ALLOCATIONS),
  })
  .superRefine(({ allocations }, ctx) => {
    const seen = new Set<string>()
    allocations.forEach(({ recipient }, i) => {
      if (seen.has(recipient)) {
        ctx.addIssue({
          code: "custom",
          path: ["allocations", i, "recipient"],
          message: "Recipient appears more than once: combine their amounts",
        })
      }
      seen.add(recipient)
    })
  })

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(BATCH_STATUSES).optional(),
})

const FundingBody = z.object({
  funder: z
    .string()
    .refine(
      (a) => StrKey.isValidEd25519PublicKey(a) || StrKey.isValidContract(a),
      "must be a Stellar address (G... or C...)"
    ),
  token: z
    .string()
    .refine(StrKey.isValidContract, "must be a token contract address (C...)"),
  txHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/, "must be a transaction hash (64 hex characters)"),
})

// Batch ids are random, so they don't reveal how many batches an organisation has
// made. Picking one that's in use is astronomically unlikely, and costs a retry.
const ID_ATTEMPTS = 3

export function batchesRouter({
  store,
  claimDataKey,
  proofs,
  vault,
}: {
  store: BatchStore
  claimDataKey: Uint8Array
  /** Undefined when proving isn't configured (CONSERVATION_CIRCUITS_DIR). */
  proofs?: ConservationProofs
  /** Undefined when the vault isn't configured (STELLAR_RPC_URL and co.). */
  vault?: VaultReader
}): Router {
  const router = Router()

  // Builds a batch from recipients and amounts: a secret per recipient, the
  // commitments and the Merkle tree. Each recipient's claim data (amount, secret,
  // Merkle path) is stored encrypted for delivery, never returned here.
  router.post(
    "/batches",
    validated({ body: CreateBatchBody }, async ({ body }, _req, res) => {
      const allocations = body.allocations.map(({ amount }) => ({
        amount,
        secret: generateSecret(),
      }))
      for (let attempt = 1; ; attempt++) {
        const batchId = randomBatchId()
        const batch = buildBatch(batchId, allocations)
        const record: BatchRecord = {
          batchId,
          name: body.name ?? null,
          status: "created",
          root: batch.root,
          total: batch.total,
          depth: batch.depth,
          recipientCount: batch.claims.length,
          createdAt: new Date(),
        }
        try {
          await store.create(
            record,
            batch.claims.map((claim) => ({
              batchId,
              leafIndex: claim.leafIndex,
              recipient: body.allocations[claim.leafIndex]!.recipient,
              claim: sealClaim(claimDataKey, batchId, claim),
              claimToken: randomBytes(32).toString("hex"),
            }))
          )
          res.status(201).json(summary(record))
          return
        } catch (err) {
          if (!(err instanceof BatchIdTakenError) || attempt >= ID_ATTEMPTS) {
            throw err
          }
        }
      }
    })
  )

  router.get(
    "/batches",
    validated({ query: ListQuery }, async ({ query }, _req, res) => {
      const batches = await store.list(query.limit, query.status)
      res.json({ batches: batches.map(summary) })
    })
  )

  router.get(
    "/batches/:batchId",
    validated(
      { params: z.object({ batchId: BatchId }) },
      async ({ params }, req, res) => {
        const batch = await store.get(params.batchId)
        if (!batch) {
          throw new HttpError(404, "batch_not_found", "No batch with this id")
        }
        const detail: BatchDetail = summary(batch)
        if (batch.status === "funded") {
          detail.claims = batch.funder
            ? await claimProgress(vault, batch.funder, params.batchId, req.log)
            : null
        }
        res.json(detail)
      }
    )
  )

  // Step 2 of the end-to-end flow: prove that the batch's allocations add up to its
  // total. Proving runs in the background; poll the batch for "proved" or "failed".
  router.post(
    "/batches/:batchId/prove",
    validated(
      { params: z.object({ batchId: BatchId }) },
      async ({ params }, _req, res) => {
        if (!proofs) {
          throw new HttpError(
            503,
            "proving_unavailable",
            "Proving isn't configured on this server"
          )
        }
        const batch = await store.get(params.batchId)
        if (!batch) {
          throw new HttpError(404, "batch_not_found", "No batch with this id")
        }
        const from = batch.status
        const started =
          (from === "created" || from === "failed") &&
          (await store.setStatus(params.batchId, from, "proving"))
        if (!started) {
          throw new HttpError(
            409,
            "invalid_status",
            `Only a created or failed batch can be proved; this one is ${from}`
          )
        }
        proofs.start(params.batchId)
        res.status(202).json(summary((await store.get(params.batchId))!))
      }
    )
  )

  // Step 3 of the end-to-end flow. The disburser's wallet sends fund_batch, built
  // with Person 3's ShieldVaultClient, and reports it here. The batch counts as
  // funded once the vault holds this batch's root and total in the reported token,
  // under the reported funder: batch ids are per funder (ADR 0003), so nobody else
  // can register this funder's id first.
  router.post(
    "/batches/:batchId/funding",
    validated(
      { params: z.object({ batchId: BatchId }), body: FundingBody },
      async ({ params, body }, req, res) => {
        if (!vault) {
          throw new HttpError(
            503,
            "chain_unavailable",
            "The vault isn't configured on this server"
          )
        }
        const batch = await store.get(params.batchId)
        if (!batch) {
          throw new HttpError(404, "batch_not_found", "No batch with this id")
        }
        if (batch.status !== "proved") {
          throw new HttpError(
            409,
            "invalid_status",
            `Only a proved batch can be funded; this one is ${batch.status}`
          )
        }

        let onChain: VaultBatch | undefined
        try {
          onChain = await vault.getBatch(body.funder, params.batchId)
        } catch (err) {
          req.log.warn({ err }, "could not read the vault")
          throw new HttpError(502, "chain_error", "Couldn't read the vault")
        }
        if (!onChain) {
          throw new HttpError(
            409,
            "not_funded",
            "The vault has no batch with this id from this funder yet"
          )
        }
        if (
          onChain.root !== batch.root ||
          onChain.total !== batch.total ||
          onChain.token !== body.token
        ) {
          throw new HttpError(
            409,
            "funding_mismatch",
            "The funder's vault batch with this id doesn't match this batch"
          )
        }

        const funded = await store.setStatus(
          params.batchId,
          "proved",
          "funded",
          {
            funder: body.funder,
            token: body.token,
            fundingTx: body.txHash,
            fundedAt: new Date(),
          }
        )
        if (!funded) {
          throw new HttpError(409, "invalid_status", "The batch changed status")
        }
        res.json(summary((await store.get(params.batchId))!))
      }
    )
  )

  return router
}

function randomBatchId(): bigint {
  return crypto.getRandomValues(new BigUint64Array(1))[0]!
}

function summary({ depth: _, ...batch }: BatchRecord): BatchSummary {
  return batch
}

/**
 * A funded batch's claim progress: the vault's running total of claims. It's public
 * on-chain and never per recipient, so it shows nothing about who has claimed.
 * Null when the vault isn't configured or can't be read.
 */
async function claimProgress(
  vault: VaultReader | undefined,
  funder: string,
  batchId: bigint,
  log: Logger
): Promise<ClaimProgress | null> {
  if (!vault) return null
  try {
    const onChain = await vault.getBatch(funder, batchId)
    if (!onChain) return null
    return {
      withdrawn: onChain.withdrawn,
      remaining: onChain.total - onChain.withdrawn,
    }
  } catch (err) {
    log.warn({ err }, "could not read the vault")
    return null
  }
}

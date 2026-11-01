import { Router } from "express"
import { z } from "zod"
import { ShieldVaultClient } from "@workspace/sdk/chain"
import {
  addressToField,
  computeNullifier,
  TESTNET_CONFIG,
} from "@workspace/sdk"
import { validated } from "../lib/validated"
import { HttpError } from "../lib/http-error"
import { openClaim, type BatchStore } from "../db/batches"

export type ClaimRouterDeps = {
  vaultClient?: ShieldVaultClient
  store?: BatchStore
  claimDataKey?: Uint8Array
}

const CheckClaimSchema = z.object({
  batchId: z.coerce.bigint(),
  nullifier: z
    .string()
    .regex(/^(0x)?[0-9a-fA-F]{64}$/, "Must be a 32-byte hex string"),
  recipient: z.string().min(50).max(60).optional(),
})

const PrepareClaimSchema = z.object({
  batchId: z.coerce.bigint(),
  recipient: z.string().trim().min(1).max(256),
  payoutAddress: z.string().min(50).max(60).optional(),
})

export function claimRouter(depsOrVault?: ClaimRouterDeps | ShieldVaultClient): Router {
  const router = Router()

  let vaultClient: ShieldVaultClient | undefined
  let store: BatchStore | undefined
  let claimDataKey: Uint8Array | undefined

  if (depsOrVault && "getBatch" in depsOrVault) {
    vaultClient = depsOrVault as ShieldVaultClient
  } else if (depsOrVault) {
    const deps = depsOrVault as ClaimRouterDeps
    vaultClient = deps.vaultClient
    store = deps.store
    claimDataKey = deps.claimDataKey
  }

  const client =
    vaultClient ??
    new ShieldVaultClient({
      contractId: TESTNET_CONFIG.contracts.vault,
      networkPassphrase: TESTNET_CONFIG.networkPassphrase,
      rpcUrl: TESTNET_CONFIG.rpcUrl,
    })

  /**
   * Checks whether a batch exists and whether a nullifier is unspent.
   */
  router.post(
    "/v1/claims/check",
    validated({ body: CheckClaimSchema }, async ({ body }, _req, res) => {
      const { batchId, nullifier, recipient } = body

      // 1. Check if the batch exists in the vault
      const batch = await client.getBatch(batchId)
      if (!batch) {
        throw new HttpError(404, "BATCH_NOT_FOUND", `Batch ${batchId} was not found on-chain`)
      }

      // 2. Format nullifier as bigint
      const cleanNullifier = nullifier.startsWith("0x")
        ? nullifier.slice(2)
        : nullifier
      const nullifierBigInt = BigInt("0x" + cleanNullifier)

      // 3. Check if nullifier has already been used
      const isSpent = await client.isNullifierUsed(batchId, nullifierBigInt)

      let recipientField: string | undefined
      if (recipient) {
        try {
          const field = await addressToField(recipient)
          recipientField = field.toString()
        } catch {
          throw new HttpError(400, "INVALID_RECIPIENT", "Invalid Stellar recipient address")
        }
      }

      res.json({
        batchId: batchId.toString(),
        batch: {
          root: "0x" + batch.root.toString(16).padStart(64, "0"),
          total: batch.total.toString(),
          withdrawn: batch.withdrawn.toString(),
          token: batch.token,
        },
        nullifier: "0x" + cleanNullifier,
        isSpent,
        isEligible: !isSpent && batch.withdrawn < batch.total,
        recipientField,
      })
    })
  )

  /**
   * Person 2: Claim Preparation API.
   * Retrieves allocation data, Merkle witness, and nullifier for an SDP recipient.
   */
  router.post(
    "/v1/claims/prepare",
    validated({ body: PrepareClaimSchema }, async ({ body }, _req, res) => {
      const { batchId, recipient, payoutAddress } = body

      if (!store || !claimDataKey) {
        throw new HttpError(
          503,
          "STORAGE_UNAVAILABLE",
          "Claim preparation requires batch store and encryption key configuration"
        )
      }

      const batch = await store.get(batchId)
      if (!batch) {
        throw new HttpError(404, "BATCH_NOT_FOUND", `Batch ${batchId} was not found`)
      }

      const allocation = await store.allocationByRecipient(batchId, recipient)
      if (!allocation) {
        throw new HttpError(
          404,
          "ALLOCATION_NOT_FOUND",
          `No allocation found for recipient '${recipient}' in batch ${batchId}`
        )
      }

      // Decrypt stored allocation claim credentials
      const claim = openClaim(claimDataKey, allocation)
      const nullifier = computeNullifier(claim.secret, claim.leafIndex)
      const nullifierHex = "0x" + nullifier.toString(16).padStart(64, "0")

      // Check on-chain nullifier status if vault is reachable
      let isSpent = false
      try {
        isSpent = await client.isNullifierUsed(batchId, nullifier)
      } catch {
        // Fall back to unspent if RPC query fails
      }

      let recipientField: string | undefined
      if (payoutAddress) {
        try {
          const field = await addressToField(payoutAddress)
          recipientField = field.toString()
        } catch {
          throw new HttpError(400, "INVALID_PAYOUT_ADDRESS", "Invalid Stellar payout address")
        }
      }

      res.json({
        batchId: batchId.toString(),
        recipient,
        leafIndex: claim.leafIndex,
        amount: claim.amount.toString(),
        secret: claim.secret.toString(),
        root: "0x" + batch.root.toString(16).padStart(64, "0"),
        nullifierHash: nullifierHex,
        pathElements: claim.pathElements.map(
          (el) => "0x" + el.toString(16).padStart(64, "0")
        ),
        pathIndices: claim.pathIndices,
        batchStatus: batch.status,
        token: batch.token || TESTNET_CONFIG.contracts.nativeAsset,
        funder: batch.funder,
        isSpent,
        isEligible: !isSpent && batch.status === "funded",
        recipientField,
      })
    })
  )

  /**
   * Secure delivery of claim credentials for an entire batch (SDP disbursement export).
   */
  router.get(
    "/v1/batches/:batchId/claims",
    async (req, res, next) => {
      try {
        const batchId = BigInt(req.params.batchId)
        if (!store || !claimDataKey) {
          throw new HttpError(503, "STORAGE_UNAVAILABLE", "Claim data is not configured")
        }

        const batch = await store.get(batchId)
        if (!batch) {
          throw new HttpError(404, "BATCH_NOT_FOUND", "Batch not found")
        }

        const allocations = await store.allocations(batchId)
        const claims = allocations.map((alloc) => {
          const claim = openClaim(claimDataKey!, alloc)
          const nullifier = computeNullifier(claim.secret, claim.leafIndex)
          return {
            recipient: alloc.recipient,
            leafIndex: claim.leafIndex,
            amount: claim.amount.toString(),
            nullifierHash: "0x" + nullifier.toString(16).padStart(64, "0"),
            claimUrl: `/claim?batch=${batchId}&recipient=${encodeURIComponent(alloc.recipient)}`,
          }
        })

        res.json({
          batchId: batchId.toString(),
          root: "0x" + batch.root.toString(16).padStart(64, "0"),
          status: batch.status,
          total: batch.total.toString(),
          claims,
        })
      } catch (err) {
        next(err)
      }
    }
  )

  return router
}

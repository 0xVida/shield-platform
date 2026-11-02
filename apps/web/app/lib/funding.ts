import type { SubmitOptions, VaultTransaction } from "@workspace/sdk/chain"

import type { Batch, VaultConnection } from "./api"
import type { SignTransaction } from "./wallet"

/**
 * Builds a proved batch's fund_batch, step 3 of the end-to-end flow. Person 3's
 * ShieldVaultClient simulates it, so a call the vault would refuse never reaches the
 * wallet. Nothing is signed yet: the page shows what will be signed first.
 */
export async function buildFunding({
  vault,
  batch,
  funder,
  token,
}: {
  vault: VaultConnection
  batch: Batch
  funder: string
  token: string
}): Promise<VaultTransaction> {
  if (!batch.proof) throw new Error("The batch has no conservation proof yet")

  // Loaded in the browser only
  const { ShieldVaultClient } = await import("@workspace/sdk/chain")
  return new ShieldVaultClient(vault).buildFundBatch({
    funder,
    batchId: BigInt(batch.batchId),
    token,
    root: BigInt(batch.root),
    total: BigInt(batch.total),
    proof: hexToBytes(batch.proof),
  })
}

/**
 * Has the wallet sign a built fund_batch, sends it and waits until it's confirmed.
 * Returns the transaction hash, for POST /v1/batches/:id/funding.
 */
export async function sendFunding(
  tx: VaultTransaction,
  {
    signTransaction,
    onStage,
  }: {
    /** The wallet's signer, e.g. useWallet().signTransaction. */
    signTransaction: SignTransaction
    onStage?: SubmitOptions["onStage"]
  }
): Promise<string> {
  const { SubmitError, submitTransaction } =
    await import("@workspace/sdk/chain")
  try {
    const { hash } = await submitTransaction(tx, { signTransaction, onStage })
    return hash
  } catch (error) {
    // Sent, but its outcome isn't known yet. Return the hash anyway, so the page keeps
    // it and never pays a second time; the API only marks the batch funded once the
    // vault holds it.
    if (
      error instanceof SubmitError &&
      error.code === "pending" &&
      error.hash
    ) {
      return error.hash
    }
    throw error
  }
}

function hexToBytes(hex: string): Uint8Array {
  const digits = hex.replace(/^0x/, "")
  return Uint8Array.from(digits.match(/../g) ?? [], (byte) =>
    parseInt(byte, 16)
  )
}

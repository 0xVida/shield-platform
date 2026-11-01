import type { Batch, VaultConnection } from "./api"
import type { SignTransaction } from "./wallet"

/**
 * Funds a proved batch, step 3 of the end-to-end flow. Person 3's ShieldVaultClient
 * builds fund_batch and simulates it, so a call the vault would refuse never reaches
 * the wallet; submitTransaction then has the wallet sign it, sends it and waits until
 * it's confirmed. Returns the transaction hash, for POST /v1/batches/:id/funding.
 */
export async function fundBatch({
  vault,
  batch,
  funder,
  token,
  signTransaction,
}: {
  vault: VaultConnection
  batch: Batch
  funder: string
  token: string
  /** The wallet's signer, e.g. useWallet().signTransaction. */
  signTransaction: SignTransaction
}): Promise<string> {
  if (!batch.proof) throw new Error("The batch has no conservation proof yet")

  // Loaded in the browser only
  const { ShieldVaultClient, SubmitError, submitTransaction } =
    await import("@workspace/sdk/chain")
  const tx = await new ShieldVaultClient(vault).buildFundBatch({
    funder,
    batchId: BigInt(batch.batchId),
    token,
    root: BigInt(batch.root),
    total: BigInt(batch.total),
    proof: hexToBytes(batch.proof),
  })
  try {
    const { hash } = await submitTransaction(tx, { signTransaction })
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

import { describe, expect, test } from "bun:test"
import { Keypair, Networks } from "@stellar/stellar-sdk"

import { FIELD_SIZE, MAX_AMOUNT, MAX_BATCH_ID } from "../protocol"
import { ShieldVaultClient } from "./vault"

// Nothing listens on port 9, so a call that reaches the network fails with a
// connection error. A RangeError therefore means the input was rejected first.
const vault = new ShieldVaultClient({
  contractId: "CBBA6C4YMS4RDTRS3TO4YNMTWVPEIGJZ53DLDKNUFFN7RRIS4P76SIDT",
  rpcUrl: "http://127.0.0.1:9",
  networkPassphrase: Networks.STANDALONE,
  allowHttp: true,
})
const account = Keypair.random().publicKey()
const proof = new Uint8Array(256)
const withdraw = {
  funder: account,
  batchId: 1n,
  proof,
  nullifier: 1n,
  recipient: account,
  amount: 1n,
}
const fund = {
  funder: account,
  batchId: 1n,
  token: "CDMLFMKMMD7MWZP3FKUBZPVHTUEDLSX4BYGYKH4GCESXYHS3IHQ4EIG4",
  root: 1n,
  total: 1n,
  proof,
}

describe("ShieldVaultClient checks inputs before any network call", () => {
  test("a valid call does reach the network (so the checks below are meaningful)", async () => {
    const error = await vault.buildWithdraw(withdraw).catch((e) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(RangeError)
  })

  test("buildWithdraw rejects bad amounts, nullifiers and batch ids", async () => {
    for (const bad of [
      { amount: 0n },
      { amount: MAX_AMOUNT + 1n },
      { nullifier: FIELD_SIZE },
      { batchId: -1n },
      { batchId: MAX_BATCH_ID + 1n },
    ]) {
      await expect(
        vault.buildWithdraw({ ...withdraw, ...bad })
      ).rejects.toThrow(RangeError)
    }
  })

  test("buildFundBatch rejects bad totals, roots and batch ids", async () => {
    for (const bad of [
      { total: 0n },
      { total: -1n },
      { root: FIELD_SIZE },
      { batchId: MAX_BATCH_ID + 1n },
    ]) {
      await expect(vault.buildFundBatch({ ...fund, ...bad })).rejects.toThrow(
        RangeError
      )
    }
  })

  test("reads reject bad batch ids and nullifiers", async () => {
    await expect(vault.getBatch(account, -1n)).rejects.toThrow(RangeError)
    await expect(
      vault.isNullifierUsed(account, 1n, FIELD_SIZE)
    ).rejects.toThrow(RangeError)
  })
})

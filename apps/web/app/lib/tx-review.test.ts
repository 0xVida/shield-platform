import { describe, expect, test } from "bun:test"

import { claimReview, fundingReview, maxFee, shortAddress } from "./tx-review"

const TESTNET = "Test SDF Network ; September 2015"
const VAULT = "CB6RKTUOZVQKEKFMJFIKVM4C7JS7VRVDYK3IBQSW5GKBOSOEYXVZMFRK"
const TOKEN = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
const ALICE = "GCJA22K2FAGFI3T3SIZATC5RFG3Z32PSNZPR7GC55JXFK556UL4IN2FC"
const RELAYER = "GBGTYDVZL6Z4EL4ZTLY3LIYTBZQWMIL3FHJY5PJV4E6EFJ45HY4VBKZ2"

describe("shortAddress", () => {
  test("keeps the first and last four characters", () => {
    expect(shortAddress(ALICE)).toBe("GCJA…N2FC")
    expect(shortAddress("short")).toBe("short")
  })
})

describe("maxFee", () => {
  test("shows a built transaction's fee in XLM", () => {
    expect(maxFee({ built: { fee: "1234567" } })).toBe("0.1234567 XLM")
    expect(maxFee({ built: { fee: "100" } })).toBe("0.00001 XLM")
  })

  test("is undefined before the transaction is built", () => {
    expect(maxFee({})).toBeUndefined()
  })
})

describe("fundingReview", () => {
  test("shows what the disburser signs, with full addresses on hover", () => {
    const lines = fundingReview({
      batchId: "42",
      total: 45_000_000n,
      token: TOKEN,
      funder: RELAYER,
      vault: VAULT,
      networkPassphrase: TESTNET,
      fee: "0.1 XLM",
    })
    expect(lines.map(({ label, value }) => [label, value])).toEqual([
      ["Action", "Fund batch 42"],
      ["Deposit", "4.5 tokens"],
      ["Token contract", "CDLZ…CYSC"],
      ["Paid from", "GBGT…BKZ2"],
      ["Vault contract", "CB6R…MFRK"],
      ["Network", "Testnet"],
      ["Maximum network fee", "0.1 XLM"],
    ])
    expect(lines.find((l) => l.label === "Paid from")?.full).toBe(RELAYER)
  })
})

describe("claimReview", () => {
  test("shows who's paid and who pays the fee", () => {
    const lines = claimReview({
      batchId: "42",
      amount: 25_000_000n,
      recipient: ALICE,
      submitter: RELAYER,
      vault: VAULT,
      networkPassphrase: TESTNET,
    })
    expect(lines.map(({ label, value }) => [label, value])).toEqual([
      ["Action", "Claim from batch 42"],
      ["Payout", "2.5 tokens"],
      ["Paid to", "GCJA…N2FC"],
      ["Fee paid by", "GBGT…BKZ2"],
      ["Vault contract", "CB6R…MFRK"],
      ["Network", "Testnet"],
    ])
  })
})

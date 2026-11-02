import { describe, expect, test } from "bun:test"

import { activityRow, filtersFromSearch, historyWarning } from "./activity"
import type { ActivityItem } from "./api"

const ALICE = "GCJA22K2FAGFI3T3SIZATC5RFG3Z32PSNZPR7GC55JXFK556UL4IN2FC"
const FUNDER = "GBGTYDVZL6Z4EL4ZTLY3LIYTBZQWMIL3FHJY5PJV4E6EFJ45HY4VBKZ2"

const funded: ActivityItem = {
  id: "0023519339697172480-0000000001",
  type: "funded",
  ledger: 5476023,
  ledgerClosedAt: "2026-10-30T23:42:35Z",
  txHash: "66cf1b66",
  batchId: "1793403748164",
  funder: FUNDER,
  token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  root: "123",
  total: "45000000",
}

const withdrawn: ActivityItem = {
  id: "0023519348287094784-0000000001",
  type: "withdrawn",
  ledger: 5476025,
  ledgerClosedAt: "2026-10-30T23:42:45Z",
  txHash: "f66ae8f9",
  batchId: "1793403748164",
  nullifier: "456",
  recipient: ALICE,
  amount: "25000000",
}

describe("filtersFromSearch", () => {
  test("reads a known type and an address", () => {
    expect(
      filtersFromSearch(new URLSearchParams(`type=withdrawn&address=${ALICE}`))
    ).toEqual({ type: "withdrawn", address: ALICE })
  })

  test("ignores an unknown type and an empty address", () => {
    expect(
      filtersFromSearch(new URLSearchParams("type=minted&address= "))
    ).toEqual({ type: undefined, address: undefined })
  })
})

describe("activityRow", () => {
  test("words a funding", () => {
    expect(activityRow(funded)).toEqual({
      key: funded.id,
      title: "Batch funded",
      amount: "4.5 tokens",
      batchId: "1793403748164",
      party: { label: "Funded by", address: FUNDER },
      when: "2026-10-30T23:42:35Z",
      txHash: "66cf1b66",
    })
  })

  test("words a claim, naming who it paid", () => {
    expect(activityRow(withdrawn)).toMatchObject({
      title: "Claim paid",
      amount: "2.5 tokens",
      party: { label: "Paid to", address: ALICE },
    })
  })
})

describe("historyWarning", () => {
  test("says nothing when the history is complete", () => {
    expect(historyWarning({ ledger: 900, gaps: [] })).toBeUndefined()
  })

  test("warns before the indexer's first run", () => {
    expect(historyWarning(null)).toContain("hasn't read the vault yet")
  })

  test("lists the ledgers that were never indexed", () => {
    const detectedAt = "2026-11-01T00:00:00Z"
    expect(
      historyWarning({
        ledger: 900,
        gaps: [
          { fromLedger: 101, toLedger: 499, detectedAt },
          { fromLedger: 700, toLedger: 700, detectedAt },
        ],
      })
    ).toBe(
      "History may be incomplete: ledgers 101–499, 700 weren't indexed before the network dropped them."
    )
  })
})

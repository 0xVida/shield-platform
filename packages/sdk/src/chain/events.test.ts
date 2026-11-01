import { describe, expect, test } from "bun:test"
import { nativeToScVal, rpc } from "@stellar/stellar-sdk"

import { parseVaultEvent } from "./events"
import { Client } from "./vault-bindings"

// A real getEvents response from testnet: one fund_batch and one withdraw
const fixture = await Bun.file(
  new URL("./fixtures/vault-events.testnet.json", import.meta.url)
).json()
const { events } = rpc.parseRawEvents(fixture.response)
const [funded, withdrawn] = events as [
  rpc.Api.EventResponse,
  rpc.Api.EventResponse,
]
const VAULT = "CB6RKTUOZVQKEKFMJFIKVM4C7JS7VRVDYK3IBQSW5GKBOSOEYXVZMFRK"

// Reading the spec makes no network call; the bindings only need a valid URL
const spec = new Client({
  contractId: VAULT,
  networkPassphrase: "Test SDF Network ; September 2015",
  rpcUrl: "https://example.invalid",
}).spec

describe("parseVaultEvent", () => {
  test("decodes a real BatchFunded event", () => {
    const event = parseVaultEvent(spec, funded)
    expect(event).toMatchObject({
      type: "funded",
      contractId: VAULT,
      txHash: fixture.fundTx,
      ledger: 5476023,
      ledgerClosedAt: "2026-10-30T23:42:35Z",
      batchId: 1793403748164n,
      funder: "GBGTYDVZL6Z4EL4ZTLY3LIYTBZQWMIL3FHJY5PJV4E6EFJ45HY4VBKZ2",
      token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      root: 0x144ce6f6fa61eb3a34aeba1cc4942b430fbe088c8673354c5de21531aa298491n,
      total: 45_000_000n,
    })
    expect(event?.id).toBe(funded.id)
  })

  test("decodes a real Withdrawn event", () => {
    const event = parseVaultEvent(spec, withdrawn)
    expect(event).toMatchObject({
      type: "withdrawn",
      contractId: VAULT,
      txHash: fixture.withdrawTx,
      ledger: 5476025,
      batchId: 1793403748164n,
      nullifier:
        0x10635507b6b3fa21f7996693cb27dee3ccd38ba429c742cec70346b8af52ff57n,
      recipient: "GCJA22K2FAGFI3T3SIZATC5RFG3Z32PSNZPR7GC55JXFK556UL4IN2FC",
      amount: 25_000_000n,
    })
  })

  test("skips an event this code doesn't know, e.g. from a newer vault", () => {
    const unknown = {
      ...funded,
      topic: [
        funded.topic[0]!,
        nativeToScVal("upgraded", { type: "symbol" }),
        funded.topic[2]!,
      ],
    }
    expect(parseVaultEvent(spec, unknown)).toBeUndefined()
  })

  test("skips an event from a failed call", () => {
    expect(
      parseVaultEvent(spec, { ...funded, inSuccessfulContractCall: false })
    ).toBeUndefined()
  })
})

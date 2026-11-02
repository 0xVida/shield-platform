import { describe, expect, test } from "bun:test"
import { nativeToScVal, rpc } from "@stellar/stellar-sdk"

import { parseVaultEvent } from "./events"
import { Client } from "./vault-bindings"

// A real getEvents response from testnet, from a vault with per-funder batch ids
// (ADR 0003): one fund_batch and one withdraw
const fixture = await Bun.file(
  new URL("./fixtures/vault-events.testnet.json", import.meta.url)
).json()
const { events } = rpc.parseRawEvents(fixture.response)
const [funded, withdrawn] = events as [
  rpc.Api.EventResponse,
  rpc.Api.EventResponse,
]
const VAULT = "CBPGGE6ESRHJQZAKEDFRTLEULS3ZVYEL5O7FFSC6OL46GUO3R4UWH3GX"
const FUNDER = "GDJNT7ZRFEV3AUNHBE7B4VVAO2N4W23AND2FMYOZXZRFYW3FMUJDAKFC"

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
      ledger: 5511212,
      ledgerClosedAt: "2026-11-02T00:35:00Z",
      batchId: 1793579695998n,
      funder: FUNDER,
      token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      root: 0x1234n << 200n,
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
      ledger: 5511213,
      funder: FUNDER,
      batchId: 1793579695998n,
      nullifier: 0x5678n << 200n,
      recipient: "GBA5EXJ3SONAQUACI73DG2BPJZY6TFK2HT5ZCOVWJWZZROFICBDE3YGS",
      amount: 25_000_000n,
    })
  })

  test("skips an event this code doesn't know, e.g. from a newer vault", () => {
    const unknown = {
      ...funded,
      // Same shape as a real event (shield, name, funder, batch id), unknown name
      topic: [
        funded.topic[0]!,
        nativeToScVal("upgraded", { type: "symbol" }),
        funded.topic[2]!,
        funded.topic[3]!,
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

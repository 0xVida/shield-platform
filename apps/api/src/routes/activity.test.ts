import { describe, expect, test } from "bun:test"
import type { TransactionOutcome, VaultEvent } from "@workspace/sdk/chain"
import { pino } from "pino"
import request from "supertest"

import { createApp } from "../app"
import { MemoryBatchStore } from "../db/memory-batches"
import { MemoryVaultEventStore } from "../db/memory-vault-events"
import type { TransactionReader } from "./activity"

const VAULT = "CB6RKTUOZVQKEKFMJFIKVM4C7JS7VRVDYK3IBQSW5GKBOSOEYXVZMFRK"
const ALICE = "GCJA22K2FAGFI3T3SIZATC5RFG3Z32PSNZPR7GC55JXFK556UL4IN2FC"
const FUNDER = "GBGTYDVZL6Z4EL4ZTLY3LIYTBZQWMIL3FHJY5PJV4E6EFJ45HY4VBKZ2"
const id = (n: number) => `${String(n).padStart(19, "0")}-0000000001`
const hash = (n: number) => n.toString(16).padStart(64, "0")

const fundedEvent: VaultEvent = {
  type: "funded",
  id: id(1),
  contractId: VAULT,
  ledger: 5476023,
  ledgerClosedAt: "2026-10-30T23:42:35Z",
  txHash: hash(1),
  batchId: 1793403748164n,
  funder: FUNDER,
  token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  root: (1n << 250n) + 1n,
  total: 45_000_000n,
}

const withdrawnEvent: VaultEvent = {
  type: "withdrawn",
  id: id(2),
  contractId: VAULT,
  ledger: 5476025,
  ledgerClosedAt: "2026-10-30T23:42:45Z",
  txHash: hash(2),
  funder: FUNDER,
  batchId: 1793403748164n,
  nullifier: (1n << 251n) + 2n,
  recipient: ALICE,
  amount: 25_000_000n,
}

async function setup(
  chain: TransactionOutcome | Error = { status: "NOT_FOUND" }
) {
  const events = new MemoryVaultEventStore()
  await events.save([fundedEvent, withdrawnEvent])
  const reader: TransactionReader = {
    getTransaction: async () => {
      if (chain instanceof Error) throw chain
      return chain
    },
  }
  const app = createApp({
    config: { CORS_ORIGINS: [] },
    logger: pino({ level: "silent" }),
    readinessChecks: {},
    batches: new MemoryBatchStore(),
    activity: { contractId: VAULT, events, chain: reader },
  })
  return { app, events }
}

describe("GET /v1/activity", () => {
  test("lists the vault's events newest first, bigints as strings", async () => {
    const { app } = await setup()
    const res = await request(app).get("/v1/activity")

    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([
      {
        id: id(2),
        type: "withdrawn",
        ledger: 5476025,
        ledgerClosedAt: "2026-10-30T23:42:45Z",
        txHash: hash(2),
        funder: FUNDER,
        batchId: "1793403748164",
        nullifier: ((1n << 251n) + 2n).toString(),
        recipient: ALICE,
        amount: "25000000",
      },
      {
        id: id(1),
        type: "funded",
        ledger: 5476023,
        ledgerClosedAt: "2026-10-30T23:42:35Z",
        txHash: hash(1),
        batchId: "1793403748164",
        funder: FUNDER,
        token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        root: ((1n << 250n) + 1n).toString(),
        total: "45000000",
      },
    ])
    expect(res.body.next).toBeNull()
  })

  test("pages with limit, next and before", async () => {
    const { app } = await setup()
    const first = await request(app).get("/v1/activity?limit=1")
    expect(first.body.items.map((i: { id: string }) => i.id)).toEqual([id(2)])
    expect(first.body.next).toBe(id(2))

    const second = await request(app).get(
      `/v1/activity?limit=1&before=${first.body.next}`
    )
    expect(second.body.items.map((i: { id: string }) => i.id)).toEqual([id(1)])
    expect(second.body.next).toBeNull()
  })

  test("filters by batch, type and address", async () => {
    const { app } = await setup()
    const ids = async (query: string) =>
      (await request(app).get(`/v1/activity?${query}`)).body.items.map(
        (i: { id: string }) => i.id
      )
    expect(await ids("type=funded")).toEqual([id(1)])
    expect(await ids(`address=${ALICE}`)).toEqual([id(2)])
    expect(await ids(`address=${FUNDER}`)).toEqual([id(2), id(1)])
    expect(await ids("batchId=1793403748164")).toEqual([id(2), id(1)])
    expect(await ids("batchId=99")).toEqual([])
  })

  test("says how complete the history is", async () => {
    const { app, events } = await setup()
    expect((await request(app).get("/v1/activity")).body.indexer).toBeNull()

    const detectedAt = new Date("2026-11-01T00:00:00Z")
    await events.saveState({
      contractId: VAULT,
      cursor: "c",
      ledger: 5493468,
      gaps: [{ fromLedger: 1, toLedger: 99, detectedAt }],
    })
    expect((await request(app).get("/v1/activity")).body.indexer).toEqual({
      ledger: 5493468,
      gaps: [
        { fromLedger: 1, toLedger: 99, detectedAt: detectedAt.toISOString() },
      ],
    })
  })

  test("returns only on-chain fields, whatever else an event carries", async () => {
    const { app, events } = await setup()
    // As if VaultEvent grew a field one day: it mustn't reach the API
    await events.save([
      { ...withdrawnEvent, id: id(3), leafIndex: 4 } as unknown as VaultEvent,
    ])
    const [item] = (await request(app).get("/v1/activity?limit=1")).body.items
    expect(Object.keys(item).sort()).toEqual(
      [
        "amount",
        "batchId",
        "funder",
        "id",
        "ledger",
        "ledgerClosedAt",
        "nullifier",
        "recipient",
        "txHash",
        "type",
      ].sort()
    )
  })

  test("rejects bad queries with 400", async () => {
    const { app } = await setup()
    for (const query of [
      "limit=0",
      "limit=101",
      "type=minted",
      "address=not-an-address",
      "batchId=-1",
      "batchId=18446744073709551616",
      "before=yesterday",
    ]) {
      const res = await request(app).get(`/v1/activity?${query}`)
      expect(res.status, query).toBe(400)
    }
  })
})

describe("GET /v1/tx/:hash", () => {
  test("an indexed transaction: confirmed, with its events", async () => {
    const { app } = await setup()
    const res = await request(app).get(`/v1/tx/${hash(2)}`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      hash: hash(2),
      status: "confirmed",
      ledger: 5476025,
      ledgerClosedAt: "2026-10-30T23:42:45Z",
      events: [{ id: id(2), type: "withdrawn", amount: "25000000" }],
    })
  })

  test("accepts an uppercase hash", async () => {
    const { app } = await setup()
    const res = await request(app).get(`/v1/tx/${hash(2).toUpperCase()}`)
    expect(res.body).toMatchObject({ hash: hash(2), status: "confirmed" })
  })

  test("not indexed: asks the chain", async () => {
    const ledger = { ledger: 5500000, ledgerClosedAt: "2026-11-01T10:00:00Z" }
    const cases: [TransactionOutcome, string][] = [
      [{ status: "SUCCESS", ...ledger }, "confirmed"],
      [{ status: "FAILED", ...ledger }, "failed"],
      [{ status: "NOT_FOUND" }, "not_found"],
    ]
    for (const [outcome, status] of cases) {
      const { app } = await setup(outcome)
      const res = await request(app).get(`/v1/tx/${hash(9)}`)
      expect(res.status).toBe(200)
      expect(res.body.status).toBe(status)
      expect(res.body.events).toEqual([])
      if (status !== "not_found") expect(res.body.ledger).toBe(5500000)
    }
  })

  test("502 when the chain can't be reached", async () => {
    const { app } = await setup(new Error("fetch failed"))
    const res = await request(app).get(`/v1/tx/${hash(9)}`)
    expect(res.status).toBe(502)
    expect(res.body.error.code).toBe("chain_error")
  })

  test("400 for a hash that isn't 64 hex characters", async () => {
    const { app } = await setup()
    for (const bad of ["abc", "z".repeat(64), hash(1) + "0"]) {
      expect((await request(app).get(`/v1/tx/${bad}`)).status).toBe(400)
    }
  })
})

describe("without a vault", () => {
  test("both routes answer 503", async () => {
    const app = createApp({
      config: { CORS_ORIGINS: [] },
      logger: pino({ level: "silent" }),
      readinessChecks: {},
      batches: new MemoryBatchStore(),
    })
    for (const path of ["/v1/activity", `/v1/tx/${hash(1)}`]) {
      const res = await request(app).get(path)
      expect(res.status).toBe(503)
      expect(res.body.error.code).toBe("chain_unavailable")
    }
  })
})

import { describe, expect, test } from "bun:test"
import { Keypair, Networks, StrKey } from "@stellar/stellar-sdk"
import type { VaultBatch } from "@workspace/sdk/chain"
import { pino } from "pino"
import request from "supertest"

import { createApp } from "../app"
import type { BatchRecord } from "../db/batches"
import { MemoryBatchStore } from "../db/memory-batches"
import type { VaultReader } from "./batches"

const CLAIM_DATA_KEY = Buffer.alloc(32, 4)
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 1))
const OTHER_TOKEN = StrKey.encodeContract(Buffer.alloc(32, 2))
const FUNDER = Keypair.random().publicKey()
const TX_HASH = "ab".repeat(32)
const CHAIN = {
  STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
  STELLAR_NETWORK_PASSPHRASE: Networks.TESTNET,
  VAULT_CONTRACT_ID: StrKey.encodeContract(Buffer.alloc(32, 3)),
}

/** A vault holding `onChain` under FUNDER (batch ids are per funder), or failing to answer. */
function fakeVault(onChain: (batch: BatchRecord) => VaultBatch | undefined) {
  let batch: BatchRecord | undefined
  const reader: VaultReader = {
    getBatch: async (funder) =>
      batch && funder === FUNDER ? onChain(batch) : undefined,
  }
  return { reader, holds: (b: BatchRecord) => (batch = b) }
}

/** What the vault stores after this batch's fund_batch in TOKEN. */
const funded = (batch: BatchRecord): VaultBatch => ({
  root: batch.root,
  token: TOKEN,
  total: batch.total,
  withdrawn: 0n,
})

function setup(vault?: VaultReader, chain: Partial<typeof CHAIN> = CHAIN) {
  const store = new MemoryBatchStore()
  const app = createApp({
    config: { CORS_ORIGINS: [], CLAIM_DATA_KEY, ...chain },
    logger: pino({ level: "silent" }),
    readinessChecks: {},
    batches: store,
    vault,
  })
  return { app, store }
}

/** Creates a batch and marks it proved, as the proving job would. */
async function provedBatch({ app, store }: ReturnType<typeof setup>) {
  const res = await request(app)
    .post("/v1/batches")
    .send({ allocations: [{ recipient: "receiver-alice", amount: "500" }] })
  const id = BigInt(res.body.batchId)
  await store.setStatus(id, "created", "proving")
  await store.setStatus(id, "proving", "proved", {
    proof: "0x" + "cd".repeat(256),
  })
  return store.batches.get(id)!
}

const report = { funder: FUNDER, token: TOKEN, txHash: TX_HASH }

describe("POST /v1/batches/:batchId/funding", () => {
  test("marks the batch funded once the vault holds its root and total in the token", async () => {
    const vault = fakeVault(funded)
    const s = setup(vault.reader)
    const batch = await provedBatch(s)
    vault.holds(batch)

    const res = await request(s.app)
      .post(`/v1/batches/${batch.batchId}/funding`)
      .send(report)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      status: "funded",
      funder: FUNDER,
      token: TOKEN,
      fundingTx: TX_HASH,
      fundedAt: expect.any(String),
    })
  })

  test("checks the reported funder's batch: another funder's id isn't this batch", async () => {
    const vault = fakeVault(funded)
    const s = setup(vault.reader)
    const batch = await provedBatch(s)
    vault.holds(batch)

    const res = await request(s.app)
      .post(`/v1/batches/${batch.batchId}/funding`)
      .send({ ...report, funder: Keypair.random().publicKey() })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe("not_funded")
    expect(s.store.batches.get(batch.batchId)?.status).toBe("proved")
  })

  test("waits for the vault: 409 while it has no batch with this id", async () => {
    const s = setup(fakeVault(funded).reader)
    const batch = await provedBatch(s)

    const res = await request(s.app)
      .post(`/v1/batches/${batch.batchId}/funding`)
      .send(report)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe("not_funded")
    expect(s.store.batches.get(batch.batchId)?.status).toBe("proved")
  })

  test("refuses a vault batch that isn't this one: another root, total or token", async () => {
    const mismatches: ((b: BatchRecord) => VaultBatch)[] = [
      // Same root and total in another token, e.g. the funder reported the wrong one
      (b) => ({ ...funded(b), token: OTHER_TOKEN }),
      (b) => ({ ...funded(b), root: b.root + 1n }),
      (b) => ({ ...funded(b), total: b.total + 1n }),
    ]
    for (const onChain of mismatches) {
      const vault = fakeVault(onChain)
      const s = setup(vault.reader)
      const batch = await provedBatch(s)
      vault.holds(batch)

      const res = await request(s.app)
        .post(`/v1/batches/${batch.batchId}/funding`)
        .send(report)
      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe("funding_mismatch")
      expect(s.store.batches.get(batch.batchId)?.status).toBe("proved")
    }
  })

  test("only funds a proved batch", async () => {
    const vault = fakeVault(funded)
    const s = setup(vault.reader)
    const created = await request(s.app)
      .post("/v1/batches")
      .send({ allocations: [{ recipient: "r", amount: "1" }] })
    const notProved = await request(s.app)
      .post(`/v1/batches/${created.body.batchId}/funding`)
      .send(report)
    expect(notProved.status).toBe(409)

    const batch = await provedBatch(s)
    vault.holds(batch)
    await request(s.app)
      .post(`/v1/batches/${batch.batchId}/funding`)
      .send(report)
    const again = await request(s.app)
      .post(`/v1/batches/${batch.batchId}/funding`)
      .send(report)
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe("invalid_status")
  })

  test("returns 503 without a vault, 502 if it can't be read, 404 for an unknown batch", async () => {
    const off = setup(undefined, {})
    const batch = await provedBatch(off)
    const unconfigured = await request(off.app)
      .post(`/v1/batches/${batch.batchId}/funding`)
      .send(report)
    expect(unconfigured.status).toBe(503)

    const down = setup({
      getBatch: async () => {
        throw new Error("connect ECONNREFUSED")
      },
    })
    const b2 = await provedBatch(down)
    const unreachable = await request(down.app)
      .post(`/v1/batches/${b2.batchId}/funding`)
      .send(report)
    expect(unreachable.status).toBe(502)

    const missing = await request(setup(fakeVault(funded).reader).app)
      .post("/v1/batches/12345/funding")
      .send(report)
    expect(missing.status).toBe(404)
  })

  test("rejects malformed addresses and transaction hashes", async () => {
    const s = setup(fakeVault(funded).reader)
    const batch = await provedBatch(s)
    for (const bad of [
      { funder: "GNOTANADDRESS" },
      { token: FUNDER },
      { txHash: "xyz" },
    ]) {
      const res = await request(s.app)
        .post(`/v1/batches/${batch.batchId}/funding`)
        .send({ ...report, ...bad })
      expect(res.status).toBe(400)
    }
  })
})

describe("GET /v1/config", () => {
  test("tells the web app which vault to fund", async () => {
    const res = await request(setup().app).get("/v1/config")
    expect(res.body).toEqual({
      vault: {
        contractId: CHAIN.VAULT_CONTRACT_ID,
        networkPassphrase: Networks.TESTNET,
        rpcUrl: CHAIN.STELLAR_RPC_URL,
        allowHttp: false,
      },
    })
  })

  test("says so when no vault is configured", async () => {
    const res = await request(setup(undefined, {}).app).get("/v1/config")
    expect(res.body).toEqual({ vault: null })
  })
})

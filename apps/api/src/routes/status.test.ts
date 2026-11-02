import { describe, expect, test } from "bun:test"
import type { VaultBatch } from "@workspace/sdk/chain"
import { pino } from "pino"
import request from "supertest"

import { createApp } from "../app"
import { MemoryBatchStore } from "../db/memory-batches"
import type { VaultReader } from "./batches"

const CLAIM_DATA_KEY = Buffer.alloc(32, 8)
const FUNDER = "GBGTYDVZL6Z4EL4ZTLY3LIYTBZQWMIL3FHJY5PJV4E6EFJ45HY4VBKZ2"

function setup(vault?: VaultReader) {
  const store = new MemoryBatchStore()
  const app = createApp({
    config: { CORS_ORIGINS: [], CLAIM_DATA_KEY },
    logger: pino({ level: "silent" }),
    readinessChecks: {},
    batches: store,
    vault,
  })
  return { app, store }
}

async function createBatch(app: ReturnType<typeof setup>["app"]) {
  const res = await request(app)
    .post("/v1/batches")
    .send({ allocations: [{ recipient: "receiver-alice", amount: "500" }] })
  return BigInt(res.body.batchId)
}

/** Takes a batch through proving and funding, as those steps would. */
async function fund(store: MemoryBatchStore, id: bigint) {
  await store.setStatus(id, "created", "proving")
  await store.setStatus(id, "proving", "proved", { proof: "0x00" })
  await store.setStatus(id, "proved", "funded", {
    funder: FUNDER,
    fundedAt: new Date(),
  })
}

describe("GET /v1/batches/:batchId: claim progress", () => {
  test("shows how much of a funded batch has been claimed, from the vault", async () => {
    const asked: [string, bigint][] = []
    const vault: VaultReader = {
      getBatch: async (funder, batchId): Promise<VaultBatch> => {
        asked.push([funder, batchId])
        return { root: 1n, token: "C", total: 500n, withdrawn: 200n }
      },
    }
    const { app, store } = setup(vault)
    const id = await createBatch(app)
    await fund(store, id)

    const res = await request(app).get(`/v1/batches/${id}`)
    expect(res.body.status).toBe("funded")
    expect(res.body.claims).toEqual({ withdrawn: "200", remaining: "300" })
    // Batch ids are per funder: it read the funder's batch
    expect(asked).toEqual([[FUNDER, id]])
  })

  test("shows claims as null when the vault can't be read, and still answers", async () => {
    const down: VaultReader = {
      getBatch: async () => {
        throw new Error("connect ECONNREFUSED")
      },
    }
    for (const vault of [down, undefined]) {
      const { app, store } = setup(vault)
      const id = await createBatch(app)
      await fund(store, id)

      const res = await request(app).get(`/v1/batches/${id}`)
      expect(res.status).toBe(200)
      expect(res.body.claims).toBeNull()
    }
  })

  test("doesn't read the vault for a batch that isn't funded", async () => {
    let reads = 0
    const { app } = setup({
      getBatch: async () => {
        reads++
        return undefined
      },
    })
    const id = await createBatch(app)

    const res = await request(app).get(`/v1/batches/${id}`)
    expect(res.body).not.toHaveProperty("claims")
    expect(reads).toBe(0)
  })
})

describe("GET /v1/batches?status=", () => {
  test("lists only the batches in that status", async () => {
    const { app, store } = setup()
    const created = await createBatch(app)
    const funded = await createBatch(app)
    await fund(store, funded)

    const ids = async (query: string) =>
      (await request(app).get(`/v1/batches${query}`)).body.batches.map(
        (b: { batchId: string }) => b.batchId
      )
    expect(await ids("?status=funded")).toEqual([funded.toString()])
    expect(await ids("?status=created")).toEqual([created.toString()])
    expect(await ids("")).toHaveLength(2)
  })

  test("rejects a status that doesn't exist", async () => {
    const res = await request(setup().app).get("/v1/batches?status=paid")
    expect(res.status).toBe(400)
  })
})

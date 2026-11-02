import { describe, expect, test } from "bun:test"
import express from "express"
import request from "supertest"
import { buildBatch, generateSecret, TESTNET_CONFIG } from "@workspace/sdk"

import { MemoryBatchStore } from "../db/memory-batches"
import { sealClaim } from "../db/batches"
import { errorHandler } from "../middleware/error-handler"
import { claimRouter } from "./claim"

const CLAIM_KEY = new Uint8Array(32).fill(7)

describe("Claim Routes", () => {
  test("POST /v1/claims/prepare > retrieves allocation data and Merkle witness for legitimate recipient", async () => {
    const store = new MemoryBatchStore()
    const batchId = 12345n
    const secret = generateSecret()
    const amount = 50000000n // 5 tokens

    const built = buildBatch(batchId, [{ amount, secret }])
    await store.create(
      {
        batchId,
        name: "Test Batch",
        status: "funded",
        root: built.root,
        total: built.total,
        depth: built.depth,
        recipientCount: 1,
        createdAt: new Date(),
        token: TESTNET_CONFIG.contracts.nativeAsset,
      },
      [
        {
          batchId,
          leafIndex: 0,
          recipient: "alice@example.com",
          claim: sealClaim(CLAIM_KEY, batchId, built.claims[0]!),
        },
      ]
    )

    const app = express()
    app.use(express.json())
    app.use(
      claimRouter({
        store,
        claimDataKey: CLAIM_KEY,
      })
    )

    const res = await request(app)
      .post("/v1/claims/prepare")
      .send({
        batchId: batchId.toString(),
        recipient: "alice@example.com",
        payoutAddress: "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR",
      })

    expect(res.status).toBe(200)
    expect(res.body.batchId).toBe("12345")
    expect(res.body.recipient).toBe("alice@example.com")
    expect(res.body.amount).toBe(amount.toString())
    expect(res.body.secret).toBe(secret.toString())
    expect(res.body.leafIndex).toBe(0)
    expect(res.body.root).toMatch(/^0x[0-9a-f]{64}$/)
    expect(res.body.nullifierHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(res.body.pathElements.length).toBe(built.depth)
    expect(res.body.pathIndices.length).toBe(built.depth)
    expect(res.body.isEligible).toBe(true)
    expect(res.body.recipientField).toBeDefined()
  })

  test("POST /v1/claims/prepare > rejects unknown recipient or unknown batch with 404", async () => {
    const store = new MemoryBatchStore()
    const app = express()
    app.use(express.json())
    app.use(
      claimRouter({
        store,
        claimDataKey: CLAIM_KEY,
      })
    )
    app.use(errorHandler)

    const res1 = await request(app)
      .post("/v1/claims/prepare")
      .send({
        batchId: "999999",
        recipient: "unknown",
      })
    expect(res1.status).toBe(404)
    expect(res1.body.error.code).toBe("BATCH_NOT_FOUND")
  })

  test("POST /v1/claims/prepare > retrieves allocation data using single-use bearer claim token", async () => {
    const store = new MemoryBatchStore()
    const batchId = 54321n
    const secret = generateSecret()
    const amount = 25000000n
    const claimToken = "a".repeat(64)

    const built = buildBatch(batchId, [{ amount, secret }])
    await store.create(
      {
        batchId,
        name: "Token Batch",
        status: "funded",
        root: built.root,
        total: built.total,
        depth: built.depth,
        recipientCount: 1,
        createdAt: new Date(),
        token: TESTNET_CONFIG.contracts.nativeAsset,
      },
      [
        {
          batchId,
          leafIndex: 0,
          recipient: "bob@example.com",
          claim: sealClaim(CLAIM_KEY, batchId, built.claims[0]!),
          claimToken,
        },
      ]
    )

    const app = express()
    app.use(express.json())
    app.use(
      claimRouter({
        store,
        claimDataKey: CLAIM_KEY,
      })
    )

    const res = await request(app)
      .post("/v1/claims/prepare")
      .send({
        token: claimToken,
        payoutAddress: "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR",
      })

    expect(res.status).toBe(200)
    expect(res.body.batchId).toBe("54321")
    expect(res.body.recipient).toBe("bob@example.com")
    expect(res.body.amount).toBe(amount.toString())
    expect(res.body.secret).toBe(secret.toString())
    expect(res.body.leafIndex).toBe(0)
    expect(res.body.root).toMatch(/^0x[0-9a-f]{64}$/)
    expect(res.body.nullifierHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(res.body.isEligible).toBe(true)
  })

  test("POST /v1/claims/prepare > rejects invalid claim token with 404", async () => {
    const store = new MemoryBatchStore()
    const app = express()
    app.use(express.json())
    app.use(
      claimRouter({
        store,
        claimDataKey: CLAIM_KEY,
      })
    )
    app.use(errorHandler)

    const res = await request(app)
      .post("/v1/claims/prepare")
      .send({
        token: "nonexistenttoken1234567890",
      })
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe("ALLOCATION_NOT_FOUND")
  })

  test("GET /v1/batches/:batchId/claims > exports sanitized recipient claim links without leaking nullifiers, amounts, or leaves", async () => {
    const store = new MemoryBatchStore()
    const batchId = 88888n
    const built = buildBatch(batchId, [
      { amount: 1000n, secret: generateSecret() },
      { amount: 2000n, secret: generateSecret() },
    ])

    const token1 = "1111111111111111111111111111111111111111111111111111111111111111"
    const token2 = "2222222222222222222222222222222222222222222222222222222222222222"

    await store.create(
      {
        batchId,
        name: "SDP Aid",
        status: "funded",
        root: built.root,
        total: built.total,
        depth: built.depth,
        recipientCount: 2,
        createdAt: new Date(),
      },
      [
        {
          batchId,
          leafIndex: 0,
          recipient: "+1234567890",
          claim: sealClaim(CLAIM_KEY, batchId, built.claims[0]!),
          claimToken: token1,
        },
        {
          batchId,
          leafIndex: 1,
          recipient: "+1987654321",
          claim: sealClaim(CLAIM_KEY, batchId, built.claims[1]!),
          claimToken: token2,
        },
      ]
    )

    const app = express()
    app.use(express.json())
    app.use(
      claimRouter({
        store,
        claimDataKey: CLAIM_KEY,
      })
    )

    const res = await request(app).get(`/v1/batches/${batchId}/claims`)
    expect(res.status).toBe(200)
    expect(res.body.claims.length).toBe(2)
    expect(res.body.claims[0].recipient).toBe("+1234567890")
    expect(res.body.claims[0].claimUrl).toBe(`/claim?token=${token1}`)
    expect(res.body.claims[1].recipient).toBe("+1987654321")
    expect(res.body.claims[1].claimUrl).toBe(`/claim?token=${token2}`)

    // Verify critical privacy fix: no credentials or cryptographic secrets leaked
    expect((res.body.claims[0] as any).nullifierHash).toBeUndefined()
    expect((res.body.claims[0] as any).amount).toBeUndefined()
    expect((res.body.claims[0] as any).leafIndex).toBeUndefined()
    expect((res.body.claims[0] as any).secret).toBeUndefined()
  })
})

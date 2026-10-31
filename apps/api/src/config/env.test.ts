import { describe, expect, test } from "bun:test"
import { Networks, StrKey } from "@stellar/stellar-sdk"

import { loadConfig, vaultConnection } from "./env"

const MONGODB_URI = "mongodb://localhost:27017/shieldzk"
const CLAIM_DATA_KEY = Buffer.alloc(32, 7).toString("base64")
const required = { MONGODB_URI, CLAIM_DATA_KEY }

describe("loadConfig", () => {
  test("applies defaults", () => {
    expect(loadConfig(required)).toEqual({
      NODE_ENV: "development",
      PORT: 4000,
      LOG_LEVEL: "info",
      MONGODB_URI,
      CORS_ORIGINS: ["http://localhost:5173"],
      CLAIM_DATA_KEY: Buffer.alloc(32, 7),
    })
  })

  test("parses PORT and a comma-separated CORS_ORIGINS", () => {
    const config = loadConfig({
      ...required,
      PORT: "8080",
      CORS_ORIGINS: "https://a.example, https://b.example",
    })
    expect(config.PORT).toBe(8080)
    expect(config.CORS_ORIGINS).toEqual([
      "https://a.example",
      "https://b.example",
    ])
  })

  test("accepts multi-host replica set URIs", () => {
    const uri = "mongodb://a:27017,b:27017/shieldzk?replicaSet=rs0"
    expect(loadConfig({ ...required, MONGODB_URI: uri }).MONGODB_URI).toBe(uri)
  })

  test("rejects a missing or non-MongoDB URI", () => {
    expect(() => loadConfig({ CLAIM_DATA_KEY })).toThrow(/MONGODB_URI/)
    expect(() =>
      loadConfig({ ...required, MONGODB_URI: "postgres://x" })
    ).toThrow(/MONGODB_URI/)
  })

  test("leaves the claim data key unset when it's missing", () => {
    expect(loadConfig({ MONGODB_URI }).CLAIM_DATA_KEY).toBeUndefined()
  })

  test("rejects a claim data key that isn't 32 bytes of base64", () => {
    const short = Buffer.alloc(16, 7).toString("base64")
    for (const key of [short, "x".repeat(43) + "!", ""]) {
      expect(() => loadConfig({ MONGODB_URI, CLAIM_DATA_KEY: key })).toThrow(
        /CLAIM_DATA_KEY/
      )
    }
  })

  test("never echoes the claim data key in its errors", () => {
    const leaked = "c2VjcmV0LWtleS10aGF0LWlzLXRvby1zaG9ydA=="
    let message = ""
    try {
      loadConfig({ MONGODB_URI, CLAIM_DATA_KEY: leaked })
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toContain("CLAIM_DATA_KEY")
    expect(message).not.toContain(leaked)
  })

  test("rejects invalid values", () => {
    expect(() => loadConfig({ ...required, PORT: "0" })).toThrow(/PORT/)
    expect(() => loadConfig({ ...required, CORS_ORIGINS: "nope" })).toThrow(
      /CORS_ORIGINS/
    )
  })
})

describe("vault settings", () => {
  const chain = {
    STELLAR_RPC_URL: "http://localhost:8000/soroban/rpc",
    STELLAR_NETWORK_PASSPHRASE: Networks.STANDALONE,
    VAULT_CONTRACT_ID: StrKey.encodeContract(Buffer.alloc(32, 1)),
  }

  test("give the vault connection, allowing http for a local RPC", () => {
    expect(vaultConnection(loadConfig({ ...required, ...chain }))).toEqual({
      contractId: chain.VAULT_CONTRACT_ID,
      networkPassphrase: Networks.STANDALONE,
      rpcUrl: chain.STELLAR_RPC_URL,
      allowHttp: true,
    })
  })

  test("are optional, but all or none", () => {
    expect(vaultConnection(loadConfig(required))).toBeUndefined()
    const { VAULT_CONTRACT_ID: _, ...partial } = chain
    expect(() => loadConfig({ ...required, ...partial })).toThrow(
      /VAULT_CONTRACT_ID/
    )
  })

  test("include the indexer's optional start ledger and poll interval", () => {
    const config = loadConfig({
      ...required,
      ...chain,
      INDEXER_START_LEDGER: "5476000",
      INDEXER_POLL_MS: "10000",
    })
    expect(config.INDEXER_START_LEDGER).toBe(5476000)
    expect(config.INDEXER_POLL_MS).toBe(10000)
    expect(loadConfig(required).INDEXER_START_LEDGER).toBeUndefined()
  })

  test("reject an invalid start ledger or a poll interval under a second", () => {
    for (const INDEXER_START_LEDGER of ["0", "-5", "1.5", "abc"]) {
      expect(() => loadConfig({ ...required, INDEXER_START_LEDGER })).toThrow(
        /INDEXER_START_LEDGER/
      )
    }
    expect(() => loadConfig({ ...required, INDEXER_POLL_MS: "100" })).toThrow(
      /INDEXER_POLL_MS/
    )
  })

  test("reject a vault id that isn't a contract address", () => {
    const account = "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR"
    expect(() =>
      loadConfig({ ...required, ...chain, VAULT_CONTRACT_ID: account })
    ).toThrow(/VAULT_CONTRACT_ID/)
  })
})

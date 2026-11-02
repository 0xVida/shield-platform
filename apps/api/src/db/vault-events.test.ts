import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { VaultEvent } from "@workspace/sdk/chain"
import { MongoClient, type Db } from "mongodb"

import { MongoVaultEventStore } from "./vault-events"

/*
 * MongoVaultEventStore against a real MongoDB. Skipped unless MONGODB_TEST_URI points
 * at one, e.g. the compose service:
 *   MONGODB_TEST_URI=mongodb://localhost:27017/shieldzk_test bun test
 * The test database is dropped afterwards.
 */
const uri = process.env.MONGODB_TEST_URI

const VAULT = "CB6RKTUOZVQKEKFMJFIKVM4C7JS7VRVDYK3IBQSW5GKBOSOEYXVZMFRK"
const FIELD = (1n << 250n) + 12345n

const fundedEvent: VaultEvent = {
  type: "funded",
  id: "0023519339697172480-0000000001",
  contractId: VAULT,
  ledger: 5476023,
  ledgerClosedAt: "2026-10-30T23:42:35Z",
  txHash: "66cf1b66",
  batchId: (1n << 64n) - 1n,
  funder: "GFUNDER",
  token: "CTOKEN",
  root: FIELD,
  total: 45_000_000n,
}

const withdrawnEvent: VaultEvent = {
  type: "withdrawn",
  id: "0023519348287094784-0000000001",
  contractId: VAULT,
  ledger: 5476025,
  ledgerClosedAt: "2026-10-30T23:42:45Z",
  txHash: "f66ae8f9",
  funder: "GFUNDER",
  batchId: (1n << 64n) - 1n,
  nullifier: FIELD + 1n,
  recipient: "GRECIPIENT",
  amount: 25_000_000n,
}

describe.skipIf(!uri)("MongoVaultEventStore", () => {
  let client: MongoClient
  let db: Db
  let store: MongoVaultEventStore

  beforeAll(async () => {
    client = await MongoClient.connect(uri!)
    db = client.db()
    await db.dropDatabase()
    store = new MongoVaultEventStore(db)
    await store.ensureIndexes()
  })

  afterAll(async () => {
    await db.dropDatabase()
    await client.close()
  })

  test("stores events with bigints intact, and each spent nullifier", async () => {
    await store.save([fundedEvent, withdrawnEvent])

    const docs = await db
      .collection("vault_events")
      .find({}, { sort: { ledger: 1 } })
      .toArray()
    expect(docs).toMatchObject([
      {
        type: "funded",
        batchId: "18446744073709551615",
        root: FIELD.toString(),
        total: "45000000",
      },
      {
        type: "withdrawn",
        nullifier: (FIELD + 1n).toString(),
        amount: "25000000",
      },
    ])
    expect(docs[0]?.ledgerClosedAt).toEqual(new Date("2026-10-30T23:42:35Z"))

    const nullifiers = await db.collection("nullifiers_seen").find().toArray()
    expect(nullifiers).toMatchObject([
      {
        contractId: VAULT,
        funder: "GFUNDER",
        batchId: "18446744073709551615",
        nullifier: (FIELD + 1n).toString(),
        ledger: 5476025,
      },
    ])
  })

  test("saving the same events again changes nothing", async () => {
    await store.save([fundedEvent, withdrawnEvent])
    await store.save([withdrawnEvent])
    expect(await db.collection("vault_events").countDocuments()).toBe(2)
    expect(await db.collection("nullifiers_seen").countDocuments()).toBe(1)
  })

  test("saves new events in a batch that also holds known ones", async () => {
    const later = {
      ...withdrawnEvent,
      id: "0023519348287094784-0000000002",
      nullifier: FIELD + 2n,
    }
    await store.save([fundedEvent, later])
    expect(await db.collection("vault_events").countDocuments()).toBe(3)
    expect(await db.collection("nullifiers_seen").countDocuments()).toBe(2)
  })

  test("keeps the indexer's state per vault", async () => {
    expect(await store.state(VAULT)).toBeUndefined()
    const state = {
      contractId: VAULT,
      cursor: "c1",
      ledger: 900,
      gaps: [
        {
          fromLedger: 1,
          toLedger: 99,
          detectedAt: new Date("2026-11-01T00:00:00Z"),
        },
      ],
    }
    await store.saveState(state)
    expect(await store.state(VAULT)).toEqual(state)

    await store.saveState({ ...state, cursor: "c2", ledger: 950 })
    expect(await store.state(VAULT)).toMatchObject({
      cursor: "c2",
      ledger: 950,
    })
    expect(await store.state("COTHER")).toBeUndefined()
  })
})

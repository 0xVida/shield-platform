import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { VaultEvent } from "@workspace/sdk/chain"
import { MongoClient } from "mongodb"

import { MemoryVaultEventStore } from "./memory-vault-events"
import { MongoVaultEventStore, type VaultEventStore } from "./vault-events"

/*
 * Reading events back, for both stores: the in-memory one always, MongoDB when
 * MONGODB_TEST_URI is set (see vault-events.test.ts). The same tests keep the
 * in-memory store, which the route tests use, honest about MongoDB's behaviour.
 */
const uri = process.env.MONGODB_TEST_URI

const VAULT = "CB6RKTUOZVQKEKFMJFIKVM4C7JS7VRVDYK3IBQSW5GKBOSOEYXVZMFRK"
const OTHER_VAULT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
const ALICE = "GALICE"
const BOB = "GBOB"
const FUNDER = "GFUNDER"
const OTHER_FUNDER = "GOTHERFUNDER"

/** An event id as the RPC writes them: zero-padded, so they sort like the events. */
const id = (n: number) => `${String(n).padStart(19, "0")}-0000000001`

function funded(
  n: number,
  batchId: bigint,
  funder = FUNDER,
  contractId = VAULT
): VaultEvent {
  return {
    type: "funded",
    id: id(n),
    contractId,
    ledger: 1000 + n,
    ledgerClosedAt: "2026-10-30T23:42:35Z",
    txHash: `tx${n}`,
    batchId,
    funder,
    token: "CTOKEN",
    root: (1n << 250n) + BigInt(n),
    total: 1_000_000n,
  }
}

function withdrawn(
  n: number,
  batchId: bigint,
  recipient: string,
  funder = FUNDER
): VaultEvent {
  return {
    type: "withdrawn",
    id: id(n),
    contractId: VAULT,
    ledger: 1000 + n,
    ledgerClosedAt: "2026-10-30T23:42:45Z",
    txHash: `tx${n}`,
    funder,
    batchId,
    nullifier: (1n << 251n) + BigInt(n),
    recipient,
    amount: 250_000n,
  }
}

const events: VaultEvent[] = [
  funded(1, 1n),
  withdrawn(2, 1n, ALICE),
  withdrawn(3, 1n, BOB),
  funded(4, 2n, OTHER_FUNDER),
  withdrawn(5, 2n, ALICE, OTHER_FUNDER),
  funded(6, 3n, FUNDER, OTHER_VAULT),
]

const ids = (list: VaultEvent[]) => list.map((event) => event.id)

function readTests(makeStore: () => Promise<VaultEventStore>) {
  let store: VaultEventStore

  beforeAll(async () => {
    store = await makeStore()
    await store.save(events)
  })

  test("lists one vault's events, newest first, with every field intact", async () => {
    const list = await store.list({ contractId: VAULT, limit: 10 })
    expect(ids(list)).toEqual([id(5), id(4), id(3), id(2), id(1)])
    expect(list.at(-1)).toEqual(events[0]!)
    expect(list[0]).toEqual(events[4]!)
  })

  test("filters by batch, type and address", async () => {
    const limit = 10
    expect(
      ids(await store.list({ contractId: VAULT, batchId: 2n, limit }))
    ).toEqual([id(5), id(4)])
    expect(
      ids(await store.list({ contractId: VAULT, type: "funded", limit }))
    ).toEqual([id(4), id(1)])
    expect(
      ids(await store.list({ contractId: VAULT, address: ALICE, limit }))
    ).toEqual([id(5), id(2)])
    // A funder's address: its fundings and the claims paid from its batches
    expect(
      ids(await store.list({ contractId: VAULT, address: FUNDER, limit }))
    ).toEqual([id(3), id(2), id(1)])
    expect(
      ids(await store.list({ contractId: VAULT, address: OTHER_FUNDER, limit }))
    ).toEqual([id(5), id(4)])
    expect(
      ids(
        await store.list({
          contractId: VAULT,
          address: ALICE,
          batchId: 1n,
          limit,
        })
      )
    ).toEqual([id(2)])
  })

  test("pages with limit and before", async () => {
    const first = await store.list({ contractId: VAULT, limit: 2 })
    expect(ids(first)).toEqual([id(5), id(4)])
    const second = await store.list({
      contractId: VAULT,
      limit: 2,
      before: first.at(-1)!.id,
    })
    expect(ids(second)).toEqual([id(3), id(2)])
    const last = await store.list({
      contractId: VAULT,
      limit: 2,
      before: second.at(-1)!.id,
    })
    expect(ids(last)).toEqual([id(1)])
  })

  test("finds a transaction's events, on that vault only", async () => {
    expect(ids(await store.byTx(VAULT, "tx3"))).toEqual([id(3)])
    expect(await store.byTx(VAULT, "tx6")).toEqual([])
    expect(ids(await store.byTx(OTHER_VAULT, "tx6"))).toEqual([id(6)])
    expect(await store.byTx(VAULT, "nope")).toEqual([])
  })
}

describe("MemoryVaultEventStore reads", () => {
  readTests(async () => new MemoryVaultEventStore())
})

describe.skipIf(!uri)("MongoVaultEventStore reads", () => {
  let client: MongoClient

  readTests(async () => {
    client = await MongoClient.connect(uri!)
    const db = client.db(`${client.db().databaseName}_reads`)
    await db.dropDatabase()
    const store = new MongoVaultEventStore(db)
    await store.ensureIndexes()
    return store
  })

  afterAll(async () => {
    await client.db(`${client.db().databaseName}_reads`).dropDatabase()
    await client.close()
  })
})

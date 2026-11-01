import { describe, expect, test } from "bun:test"

import { nullifierHash } from "./nullifier"
import { FIELD_SIZE, TREE_DEPTH } from "./protocol"

// Shared vectors from shield-contracts/circuits/test-vectors (see README).
interface NullifierVector {
  name: string
  secret: string
  leafIndex: number
  nullifier: string
}
const { vectors }: { vectors: NullifierVector[] } = await Bun.file(
  new URL("../test-vectors/nullifier.json", import.meta.url)
).json()

interface BatchVector {
  name: string
  depth: number
  allocations: { secret: string }[]
  claims: { leafIndex: string; nullifier: string }[]
}
const { batches }: { batches: BatchVector[] } = await Bun.file(
  new URL("../test-vectors/batch.json", import.meta.url)
).json()

describe("nullifierHash", () => {
  for (const v of vectors) {
    test(`matches the shared vector: ${v.name}`, () => {
      expect(nullifierHash(BigInt(v.secret), v.leafIndex)).toBe(
        BigInt(v.nullifier)
      )
    })
  }

  for (const batch of batches) {
    test(`matches every claim's nullifier in the shared batch: ${batch.name}`, () => {
      batch.claims.forEach((claim, i) => {
        const secret = BigInt(batch.allocations[i]!.secret)
        expect(
          nullifierHash(secret, Number(claim.leafIndex), batch.depth)
        ).toBe(BigInt(claim.nullifier))
      })
    })
  }

  test("differs between leaves that share a secret", () => {
    expect(nullifierHash(7n, 0)).not.toBe(nullifierHash(7n, 1))
  })

  test("rejects inputs the claim circuit doesn't accept", () => {
    expect(() => nullifierHash(-1n, 0)).toThrow(RangeError)
    expect(() => nullifierHash(FIELD_SIZE, 0)).toThrow(RangeError)
    expect(() => nullifierHash(1n, -1)).toThrow(RangeError)
    expect(() => nullifierHash(1n, 1.5)).toThrow(RangeError)
    expect(() => nullifierHash(1n, 2 ** TREE_DEPTH)).toThrow(RangeError)
    expect(() => nullifierHash(1n, 8, 3)).toThrow(RangeError)
  })

  test("keeps the secret out of error messages", () => {
    const secret = FIELD_SIZE + 123456789n
    let message = ""
    try {
      nullifierHash(secret, 0)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).not.toBe("")
    expect(message).not.toContain(secret.toString())
  })
})

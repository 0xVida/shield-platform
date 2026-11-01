import { poseidon3 } from "poseidon-lite/poseidon3"

import { isFieldElement } from "./field"
import { NULLIFIER_DOMAIN, TREE_DEPTH } from "./protocol"

/**
 * Nullifier of the allocation at `leafIndex`: Poseidon(NULLIFIER_DOMAIN, secret,
 * leafIndex), circomlib parameters over BN254. A claim publishes it so the vault can
 * mark the allocation as claimed, without revealing which leaf it is. Mirrors
 * NullifierHasher in shield-contracts/circuits/nullifier.circom.
 *
 * Throws on inputs the claim circuit rejects: secret must be a field element, and
 * leafIndex a leaf of a tree of depth `depth`.
 */
export function nullifierHash(
  secret: bigint,
  leafIndex: number,
  depth: number = TREE_DEPTH
): bigint {
  // Never put the secret itself in an error: errors end up in logs
  if (!isFieldElement(secret)) {
    throw new RangeError("Secret must be a field element")
  }
  if (
    !Number.isInteger(leafIndex) ||
    leafIndex < 0 ||
    leafIndex >= 2 ** depth
  ) {
    throw new RangeError(`Leaf index out of range: ${leafIndex}`)
  }
  return poseidon3([NULLIFIER_DOMAIN, secret, BigInt(leafIndex)])
}

/** Alias for nullifierHash */
export const computeNullifier = nullifierHash

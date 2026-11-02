# ShieldZK — Architecture

## Components

| Component | Repo / path | Owner |
|---|---|---|
| Conservation circuit | `shield-contracts/circuits` | Person 1 (@IbrahimIjai) |
| Withdraw circuit: membership + ownership | `shield-contracts/circuits` | Person 2 (@0xVidavida) |
| Withdraw circuit: nullifier + binding | `shield-contracts/circuits` | Person 3 (@koxyG) |
| Vault: batch registration & conservation check | `shield-contracts/contracts/shield-vault` | Person 1 (@IbrahimIjai) |
| Vault: claim validation | `shield-contracts/contracts/shield-vault` | Person 2 (@0xVidavida) |
| Vault: nullifier tracking & fund release | `shield-contracts/contracts/shield-vault` | Person 3 (@koxyG) |
| Groth16 verifier contract | `shield-contracts/contracts/shield-verifier` | Person 2 (@0xVidavida) |
| Proof / commitment SDK | `shield-platform/packages/sdk` | Shared |
| Confidential disbursement service + SDP adapter | `shield-platform/apps/api` | To be split |
| Disburser and recipient demo UI | `shield-platform/apps/web` | To be split |

Ownership is detailed in [team.md](team.md).

## End-to-end flow

1. **Create batch:** operator selects an SDP disbursement and enables confidential
   mode. The API generates a secret per recipient, computes commitments, and builds
   the batch Merkle tree.
2. **Prove conservation:** the disburser shows that the committed allocations sum
   to the total `T`. The mechanism is open (see D5).
3. **Fund:** disburser calls `vault.fund_batch(funder, batch_id, token, root, T, proof)`.
   The vault verifies the conservation proof, pulls `T` tokens and stores
   `{root, token, T, withdrawn = 0}` under `(funder, batch_id)`: batch ids are per
   funder (ADR 0003).
4. **Distribute claim data:** each recipient privately receives
   `{funder, batch_id, amount, secret, leaf_index, merkle_path}` over the existing SDP
   invitation / wallet channel.
5. **Claim:** the recipient's wallet (or the demo UI) generates a withdraw proof
   using the SDK.
6. **Withdraw:** `vault.withdraw(funder, batch_id, proof, nullifier, recipient, amount)`.
   The vault checks the root, checks the nullifier hasn't been used, verifies the
   proof, records the nullifier, and transfers the funds.
7. **Off-ramp:** funds go out through the existing SDP wallet / SEP-24 rails.

## Shared protocol specification

All three components must match these exactly. Changes go through a decision record.

| Item | Definition |
|---|---|
| Field | BN254 scalar field |
| Hash | Poseidon, **circomlib parameters**. The Soroban Poseidon host function must produce identical outputs; verify with shared test vectors before Phase 2. |
| Commitment | `Poseidon(amount, secret, batch_id)`, implemented in `circuits/commitment.circom` (`AllocationCommitment`). `claim.circom` still has to adopt it. |
| Nullifier | `Poseidon(TAG, secret, leafIndex)` with `TAG` = ASCII `"shieldzk.nullifier"` as a field element (domain separation from commitments). `leafIndex` is rebuilt in-circuit from `pathIndices`. Implemented in `circuits/nullifier.circom`; JS mirror in `circuits/lib/nullifier.js`. Scope: per batch; the vault stores `(funder, batch_id, nullifier)` and rejects non-canonical values (≥ field modulus). |
| Merkle tree | Binary Poseidon tree, one tree per batch, depth 10 (= 1024 recipients) (proposed). Empty leaves = 0, leaves in insertion order, root is one field element. |
| Amount | Integer in token base units, range-checked to 64 bits in-circuit |
| Recipient binding | Recipient is a public input, so a proof can't be front-run or redirected. Encoding (D4): `sha256(ScVal XDR of the address)` with the top 3 bits cleared (253 bits). Implemented in `circuits/lib/recipient.js` and the vault's `recipient_to_field`; both checked against `circuits/test-vectors/recipient.json`. |
| Withdraw public inputs | `[root, nullifierHash, recipient, amount]`, in this order. `batch_id` and `funder` are not public inputs: the vault looks up the batch's stored root by `(funder, batch_id)`. `amount` is public (D1, option b). |
| Conservation public inputs | TBD (depends on D5) |
| Test vectors | `shield-contracts/circuits/test-vectors/*.json`, produced by Person 1 and used by everyone |

## Circuits

- **`withdraw.circom`**: proves knowledge of `(amount, secret)` such that the
  commitment is a leaf under `root` (Merkle membership with a private path), and
  that `nullifier` is derived correctly.
- **Conservation circuit**: design open (see D5).

## Contracts

- **Vault:** `fund_batch`, `withdraw`, `get_batch`, `is_nullifier_used`.
  Invariant: `withdrawn ≤ total` for every batch.
  Batches are identified by `(funder, batch_id)` (ADR 0003).
- **Verifier:** Groth16 verification over BN254 using Soroban's native pairing host
  functions. Verifying keys for both circuits are stored at deploy time.
- Phase 1 uses a mock verifier behind the same interface.

## SDP integration

- SDP's normal path queues direct payments via the Core Service and the Transaction
  Submission Service. Confidential claims need a **separate execution path**; a
  database flag alone isn't enough.
- New tables (proposed): `confidential_batches`, `confidential_allocations`
  (encrypted claim data, leaf index), and `nullifiers_seen` (mirror of on-chain state).
- Reuse SDP's wallet registration and SMS invitation flow to deliver claim data.

## Open decisions

- **D1. Withdrawal amount leakage.** ✅ Decided for Phase 1: option (b), a public
  payout amount. Privacy covers the allocation phase: the deposit hides what each
  recipient gets, but each claim's amount and destination are visible on-chain.
  It's what the circuits, vault and apps implement today; (a) or (c) would mean
  redesigning the claim and conservation circuits. Revisit before mainnet.
  A plain Soroban token transfer reveals the amount and destination. Options were:
  (a) fixed-denomination notes (an allocation is split into standard denominations);
  (b) a public payout amount, which limits privacy to the allocation phase and to
      linkage among claims of the same amount;
  (c) an additional confidential balance layer.
- **D2. Who holds recipient secrets** before claim (generated server-side and
  delivered encrypted, vs. derived on the recipient's device).
- **D3. Trusted setup source:** which existing Powers of Tau file, and whether we run
  a phase-2 ceremony for each circuit.
- **D4. Recipient address → field encoding.** ✅ Decided: `sha256(ScVal XDR)` with the top 3 bits cleared. See the "Recipient binding" row above.
- **D5. Balance conservation design (open discussion).** Publishing commitments
  doesn't by itself prove their sum equals the deposit. The proof must tie to the
  actual committed leaves and include amount range constraints. Approaches to
  discuss include a single batch proof over the root and sum at funding time, or
  per-claim accounting enforced by the contract. Person 1 to propose; whole team
  to review.
- **D6. SDP integration boundary (open — @IbrahimIjai to decide).** How confidential
  batches relate to SDP disbursements. SDP must never *execute* payments for a
  confidential batch: starting an SDP disbursement makes SDP pay every recipient in
  cleartext.

  > **Suggestion (from @koxyG):** don't mirror confidential batches as SDP
  > disbursements. Use only SDP's Receivers and Registration APIs (recipient records,
  > SMS invitations, wallet registration), and let ShieldZK own the batch record
  > (commitments, root, funding, claims). Reasons:
  > - A mirrored draft disbursement is one "Start" away from paying everyone in cleartext.
  > - SDP's disbursement CSV needs per-recipient amounts, which would put every
  >   allocation in plaintext in SDP's database.
  > - The draft would never complete, which confuses operators' dashboards and reports.
  >
  > **Check first (1–2 day spike on a local SDP):** in SDP's normal flow, invitations are
  > triggered by a disbursement. Confirm whether receivers created via the API get
  > invited and can register a wallet without a started disbursement. If not, ShieldZK
  > could send its own claim invitations and reuse SDP only for receiver records and
  > wallet registration.

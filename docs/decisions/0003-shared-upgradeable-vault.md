# 0003 — Shared, upgradeable vault

- **Status:** Part 1 (per-funder batch ids) accepted and implemented; part 2 (upgradeable vault) deferred
- **Date:** 2026-10-26 (proposed), 2026-11-02 (part 1 accepted)
- **Proposed by:** Person 3 ([@koxyG](https://github.com/koxyG))
- **Affects:** ADR 0002 (batch ids), vault storage layout and constructor

## Status update (2026-11-02)

**Part 1, batch ids per funder: accepted and implemented** in shield-contracts and
shield-platform (`feat/funder-scoped-batches` in both). Batches and nullifiers are
keyed by `(funder, batch_id)`; `withdraw`, `get_batch` and `is_nullifier_used` take the
funder, and `BatchFunded` and `Withdrawn` carry it as a topic. Tested end to end on
testnet with a real claim proof: an attacker who registers the same id first, with
the disburser's root and proof and a worthless token, now creates only their own
batch; the disburser still funds the id, and claims on it pay the real token.

The attack is worse than Context item 1 describes, as ADR 0002 points out: the
attacker doesn't need a batch of their own, they can replay the disburser's own
proof with a token they mint, so the id holds the disburser's root but pays junk.
Part 1 closes that as well.

**Part 2, the upgradeable vault: deferred.** Redeploying is acceptable on testnet,
and an upgrade key is a custody decision for the whole team (see Consequences).
Revisit before mainnet, with the multisig admin and a timelock or a freeze.

## Context

The vault is already permissionless: any funder can register a batch, and batches are
isolated by `batch_id` (see the `batches_cannot_draw_on_each_others_funds` test). We
want to run it as shared infrastructure, meaning one deployment per network that any
organisation can use, rather than one deployment per organisation.

Two properties of the current contract get in the way:

1. **Batch ids are global and first come, first served.** ADR 0002 accepts that someone
   could register an id first to block it, since the disburser can pick another id.
   That holds for a single operator. On a shared deployment it becomes a cheap,
   repeatable griefing attack on any organisation. The attacker watches for a pending
   `fund_batch`, then registers the same id first with a 1-unit batch of their own. The
   victim has to rebuild every commitment (each one includes `batch_id`), rebuild the
   tree, and re-run the 581k-constraint conservation proof. It costs the attacker one
   base unit, one small proof and a fee, every time.
2. **The vault can't be upgraded.** Every fix means a new deployment at a new address
   with empty state. Batches funded on the old vault, their funds and their nullifiers
   stay there, so the SDK, the indexer and recipients' claim data all have to track
   which vault each batch lives on. D1 is still open and will likely change
   `withdraw`, so we expect several more changes during testnet.

## Decision

### 1. One shared vault per network; batch ids are scoped per funder

Batches are keyed by `(funder, batch_id)` instead of `batch_id`:

| Storage key | Before | After |
|---|---|---|
| Batch | `Batch(batch_id)` | `Batch(funder, batch_id)` |
| Nullifier | `Nullifier(batch_id, nullifier)` | `Nullifier(funder, batch_id, nullifier)` |

- `fund_batch(funder, batch_id, …)`: unchanged signature. `BatchExists` now only fires
  if *this funder* reuses an id. Someone else registering the same number creates a
  separate batch and blocks nobody.
- `withdraw(funder, batch_id, proof, nullifier, recipient, amount)`: takes `funder` to
  locate the batch. Anyone can still submit it (e.g. a relayer).
- `get_batch(funder, batch_id)` and `is_nullifier_used(funder, batch_id, nullifier)`
  change the same way.
- `BatchFunded` and `Withdrawn` events add `funder` as a topic.

**Circuits are unchanged.** The commitment stays `Poseidon(amount, secret, batch_id)`,
and both circuits keep their public inputs. A copied proof doesn't let anyone take over
a batch: a front-runner who replays a funder's conservation proof under their own
address creates *their own* batch and pays its `total` themselves.

### 2. Upgradeable through an admin

The vault gets an admin and an upgrade function that uses Soroban's native in-place
upgrade, so **the address and all storage are kept**:

- `__constructor(admin, verifier, conservation_verifier)`: stores `admin` in instance
  storage.
- `upgrade(new_wasm_hash)`: `admin.require_auth()`, then
  `env.deployer().update_current_contract_wasm(new_wasm_hash)`. Emits `Upgraded`.
- `set_admin(new_admin)`: `admin.require_auth()`. Emits `AdminChanged`.

**The admin is a team multisig account**, not one person's key: a Stellar account with
the three team members as signers and a threshold of 2. `require_auth()` on that
address enforces the account's thresholds natively, so the contract needs no multisig
logic of its own.

**Staged trust model:**

| Stage | Upgrade control |
|---|---|
| Testnet / pilot | Multisig admin, immediate upgrades |
| Before mainnet (to decide) | Either a timelock (`propose_upgrade` stores the hash and the earliest ledger it can apply; `apply_upgrade` after the delay, giving users time to withdraw), or freeze the contract by removing the admin |

## Rationale

- **One address for everyone.** The SDK, indexer and wallets talk to a single
  contract per network. A factory that deploys a vault per organisation would also
  isolate funds, but per-batch accounting already does that, and a factory multiplies
  addresses, deployments and indexing work.
- **Scoping by funder removes the griefing attack** without touching the circuits or
  the commitment formula. The disburser still picks the id before building the tree,
  as ADR 0002 requires.
- **Upgrading in place keeps state.** No migration of batches, no stranded funds,
  and no "which vault is this batch on" bookkeeping during testnet.
- **The multisig admin** means no single compromised or lost key can upgrade or
  brick the contract.

## Consequences

- **Upgrade power is custody power.** Whoever controls `admin` can replace the code,
  including code that sends all funds elsewhere. Users and auditors have to trust the
  admin until the contract is timelocked or frozen. This must be stated plainly in
  user-facing docs, and the admin account's signers should be published.
- **Upgrades must keep storage compatible.** A new version must read the existing
  `DataKey` entries and the `Batch` layout, or add explicit migration code. Every
  upgrade PR needs a test that loads state written by the previous version.
- **Circuit changes don't stop at the vault.** A new withdraw circuit needs a new
  verifier (new verifying key). If the commitment formula changes, batches already
  funded under the old formula can no longer be claimed with the new circuit. Such
  changes need a plan for old batches (keep the old verifier for them, or drain them
  first).
- **`withdraw` gains a `funder` argument.** Claim data delivered to recipients
  (architecture flow, step 4) must include the funder's address alongside `batch_id`.
  It's already public on-chain through `BatchFunded`, so this reveals nothing new.
- **Breaking change for current code.** The vault's tests, the generated SDK
  bindings and the deployment script all need updating. Better done now, before
  Phase 2 code depends on the current signatures.

## Alternatives considered

- **Keep global ids (ADR 0002 as is).** Simplest, but it leaves griefing open on a
  shared deployment (see Context).
- **Contract-assigned ids (a counter).** No collisions, but the id is only known after
  funding, while every commitment needs it beforehand. It would need a separate
  reserve-then-fund step.
- **Factory: one vault per organisation.** Strong isolation and no shared upgrade
  key, but many addresses to deploy, index and upgrade. Per-batch accounting already
  isolates funds.
- **Immutable vault, redeploy on every change.** No custody trust in an admin, but
  state and funds are stranded on old addresses at every fix. Reasonable for mainnet
  once the design settles, and the timelock-or-freeze stage above leads there.

## Spec changes if accepted

**architecture.md**

| Item | Change |
|---|---|
| End-to-end flow, step 3 | `vault.fund_batch(funder, batch_id, …)`; batches are identified by `(funder, batch_id)` |
| End-to-end flow, step 4 | Claim data adds the funder's address: `{funder, batch_id, amount, secret, leaf_index, merkle_path}` |
| End-to-end flow, step 6 | `vault.withdraw(funder, batch_id, proof, nullifier, recipient, amount)` |
| Nullifier | Scope: per `(funder, batch_id)` |
| Contracts → vault | Shared deployment per network; add `upgrade`, `set_admin`; constructor takes `admin`; `get_batch` / `is_nullifier_used` take `funder` |

**ADR 0002**

| Item | Change |
|---|---|
| Consequences → "The batch id comes first" | The id is unique per funder, not globally; see ADR 0003 |

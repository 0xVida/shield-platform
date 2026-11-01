# api

Express 5 API, run on Bun.

```bash
cp .env.example .env   # Bun loads .env automatically
echo "CLAIM_DATA_KEY=$(openssl rand -base64 32)" >> .env
bun run dev            # watch mode on :4000 (needs MongoDB: `docker compose up -d` at the root)
bun test               # add MONGODB_TEST_URI=mongodb://localhost:27017/shieldzk_test to also test the MongoDB store
```

To also test the real prover, point `CONSERVATION_TEST_CIRCUITS_DIR` at
shield-contracts' `circuits` after `pnpm build` there (it uses `test_conservation`).

## Layout

| Path | What |
|---|---|
| `src/index.ts` | Boot: config, MongoDB, HTTP server, graceful shutdown |
| `src/app.ts` | `createApp()`: middleware, routers, error handling. Does no I/O, so tests use it directly |
| `src/config/env.ts` | Environment schema; invalid config fails the boot |
| `src/routes/` | Routers. Feature routers mount under `/v1` |
| `src/db/batches.ts` | Batch storage (`confidential_batches`, `confidential_allocations`) and claim-data encryption |
| `src/db/vault-events.ts` | The vault's on-chain events (`vault_events`, `nullifiers_seen`) and the indexer's position (`indexer_state`). Only public on-chain data: claims are never matched to allocations |
| `src/indexer/` | `VaultIndexer` copies the vault's events into MongoDB while the vault is configured, and records a gap if the RPC dropped ledgers before it read them |
| `src/lib/validated.ts` | Typed request parsing for handlers |
| `src/lib/encryption.ts` | AES-256-GCM, bound to a context so ciphertext can't move between records |
| `src/proving/` | Conservation proofs: `ConservationProofs` proves batches one at a time in the background, with shield-contracts' `circuits/lib/conservation.js` run under Node by `scripts/prove-conservation.cjs` (snarkjs hangs under Bun) |
| `src/middleware/error-handler.ts` | One JSON error shape for every failure |

## Conventions

- Parse requests with `validated({ params, query, body }, handler)`. The handler
  gets typed, parsed input; a failed parse becomes a 400.
- Throw `HttpError(status, code, message)` for expected failures. Anything else
  becomes a generic 500, with the stack in the logs only.
- Errors look like `{ "error": { "code": "...", "message": "...", "details": ... } }`.
- Bigints (amounts, field elements) go out as decimal strings.
- Never log request bodies or claim data: they hold allocation amounts and secrets.
- Claim data is stored encrypted under `CLAIM_DATA_KEY`. Read it with `openClaim()`
  (`src/db/batches.ts`); never return it from an operator endpoint.

## Endpoints

| Route | |
|---|---|
| `GET /health` | Liveness |
| `GET /ready` | Readiness: pings MongoDB, 503 if a dependency is down |
| `POST /v1/batches` | Creates a confidential batch from `{ name?, allocations: [{ recipient, amount }] }` (1 to 1024; amounts are decimal strings of base units; each recipient once). Generates a secret per recipient and builds the commitments and Merkle tree. Returns the batch's summary; claim data is stored encrypted, never returned |
| `GET /v1/batches` | Batch summaries, newest first (`?limit=`, 1 to 100, default 20; `?status=` to list only `created`, `proving`, `proved`, `failed` or `funded` batches) |
| `GET /v1/batches/:batchId` | One batch's summary: `batchId`, `name`, `status`, `root`, `total`, `recipientCount`, `createdAt`, plus `proof` once proved, `error` if proving failed, and `funder`, `token`, `fundingTx`, `fundedAt` once funded. A funded batch also shows `claims: { withdrawn, remaining }`, the vault's running total (never per recipient), or `null` when the vault can't be read |
| `POST /v1/batches/:batchId/prove` | Generates the batch's conservation proof in the background (step 2 of the flow) for a `created` or `failed` batch: 202 with status `proving`, then `proved` with `proof` (hex, the 256 bytes `fund_batch` takes) or `failed` with `error`. 409 for any other status, 503 if `CONSERVATION_CIRCUITS_DIR` isn't set |
| `POST /v1/batches/:batchId/funding` | Step 3 of the flow: after the disburser's wallet sent `fund_batch` (built with `@workspace/sdk/chain`), reports `{ funder, token, txHash }`. The batch becomes `funded` once the vault, read with `ShieldVaultClient.getBatch`, holds its root and total in that token. 409 `not_funded` while the vault has no such batch, 409 `funding_mismatch` if its batch differs (someone else registered the id), 409 unless the batch is `proved`, 503 without a vault configured |
| `GET /v1/config` | Public settings for the web app: `{ vault: { contractId, networkPassphrase, rpcUrl, allowHttp } \| null }`, the vault to build `fund_batch` for |
| `GET /v1/activity` | The vault's indexed events, newest first: `{ items, next, indexer }`. Filters: `?batchId=`, `?address=` (a funder or recipient, `G...` or `C...`), `?type=funded\|withdrawn`; `?limit=` 1 to 100 (default 20); `?before=<next>` for the next page. `indexer` is `{ ledger, gaps }`, or `null` before the first poll: gaps are ledger ranges the indexer never read, so history there is incomplete. Only on-chain fields; never which allocation a claim was. 503 without a vault |
| `GET /v1/tx/:hash` | A transaction's status: `confirmed` with its vault events once indexed; `confirmed` with no events while not indexed yet (or not a vault call); `failed`; or `not_found` (pending, never sent, expired, or older than the RPC keeps). 502 if the RPC can't be reached, 503 without a vault |

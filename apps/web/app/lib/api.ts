/*
 * Client for the ShieldZK API (apps/api). Bigints arrive as decimal strings, and
 * byte strings as 0x-prefixed hex, as the API sends them.
 */

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000"

export type BatchStatus = "created" | "proving" | "proved" | "failed" | "funded"

export type Batch = {
  batchId: string
  name: string | null
  status: BatchStatus
  root: string
  total: string
  recipientCount: number
  createdAt: string
  proof?: string
  error?: string
  funder?: string
  token?: string
  fundingTx?: string
  fundedAt?: string
  /** On a funded batch: the vault's running total of claims, null if unreadable. */
  claims?: { withdrawn: string; remaining: string } | null
}

/** The vault to fund, as `@workspace/sdk/chain`'s ShieldVaultClient takes it. */
export type VaultConnection = {
  contractId: string
  networkPassphrase: string
  rpcUrl: string
  allowHttp: boolean
}

/** An error response from the API: `{ error: { code, message, details } }`. */
export class ApiError extends Error {
  override readonly name = "ApiError"
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown
  ) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_URL + path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  })
  const body = await res.json().catch(() => undefined)
  if (!res.ok) {
    const error = body?.error
    throw new ApiError(
      res.status,
      error?.code ?? "error",
      error?.message ?? res.statusText,
      error?.details
    )
  }
  return body as T
}

export const api = {
  listBatches: (status?: BatchStatus) =>
    request<{ batches: Batch[] }>(
      `/v1/batches${status ? `?status=${status}` : ""}`
    ),

  getBatch: (batchId: string) => request<Batch>(`/v1/batches/${batchId}`),

  /** Amounts are base units, as decimal strings. */
  createBatch: (body: {
    name?: string
    allocations: { recipient: string; amount: string }[]
  }) =>
    request<Batch>("/v1/batches", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  prove: (batchId: string) =>
    request<Batch>(`/v1/batches/${batchId}/prove`, { method: "POST" }),

  reportFunding: (
    batchId: string,
    body: { funder: string; token: string; txHash: string }
  ) =>
    request<Batch>(`/v1/batches/${batchId}/funding`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  config: () => request<{ vault: VaultConnection | null }>("/v1/config"),

  prepareClaim: (body: { batchId: string; recipient: string; payoutAddress?: string }) =>
    request<PreparedClaim>("/v1/claims/prepare", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  checkClaim: (body: { batchId: string; nullifier: string; recipient?: string }) =>
    request<any>("/v1/claims/check", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getBatchClaims: (batchId: string) =>
    request<{
      batchId: string
      root: string
      status: string
      total: string
      claims: BatchClaimExport[]
    }>(`/v1/batches/${batchId}/claims`),
}

export type PreparedClaim = {
  batchId: string
  recipient: string
  leafIndex: number
  amount: string
  secret: string
  root: string
  nullifierHash: string
  pathElements: string[]
  pathIndices: number[]
  batchStatus: string
  token: string
  funder?: string
  isSpent: boolean
  isEligible: boolean
  recipientField?: string
}

export type BatchClaimExport = {
  recipient: string
  leafIndex: number
  amount: string
  nullifierHash: string
  claimUrl: string
}


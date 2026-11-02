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

/** A vault event, as GET /v1/activity and GET /v1/tx/:hash return it. */
export type ActivityItem = {
  id: string
  ledger: number
  ledgerClosedAt: string
  txHash: string
  batchId: string
} & (
  | {
      type: "funded"
      funder: string
      token: string
      root: string
      total: string
    }
  | {
      type: "withdrawn"
      /** The funder whose batch paid the claim. */
      funder: string
      nullifier: string
      recipient: string
      amount: string
    }
)

/** GET /v1/activity: a page of events, and how complete the history is. */
export type ActivityPage = {
  items: ActivityItem[]
  /** Pass as `before` for the next page; null on the last page. */
  next: string | null
  /** Null before the indexer's first poll. Gaps are ledgers it never read. */
  indexer: {
    ledger: number
    gaps: { fromLedger: number; toLedger: number; detectedAt: string }[]
  } | null
}

/** GET /v1/tx/:hash. */
export type TransactionStatus = {
  hash: string
  status: "confirmed" | "failed" | "not_found"
  ledger?: number
  ledgerClosedAt?: string
  events: ActivityItem[]
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
  let timer: any
  let signal = init?.signal
  if (!signal && typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    signal = AbortSignal.timeout(5000)
  }

  try {
    const res = await fetch(API_URL + path, {
      ...init,
      signal,
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
  } catch (err: any) {
    if (err instanceof ApiError) throw err
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new ApiError(
        504,
        "TIMEOUT",
        `API request to ${path} timed out. Ensure the backend server is running on ${API_URL}.`
      )
    }
    throw new ApiError(
      503,
      "NETWORK_ERROR",
      `Could not reach API server at ${API_URL}. Is the backend running?`
    )
  }
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

  /** A transaction's status, from the indexed vault events or the RPC. */
  tx: (hash: string) => request<TransactionStatus>(`/v1/tx/${hash}`),

  /** The vault's on-chain activity, newest first. */
  activity: (query: {
    type?: ActivityItem["type"]
    address?: string
    batchId?: string
    before?: string
    limit?: number
  }) => {
    const params = new URLSearchParams(
      Object.entries(query)
        .filter(([, value]) => value !== undefined && value !== "")
        .map(([key, value]) => [key, String(value)])
    )
    const search = params.size > 0 ? `?${params}` : ""
    return request<ActivityPage>(`/v1/activity${search}`)
  },

  prepareClaim: (body: {
    token?: string
    batchId?: string
    recipient?: string
    payoutAddress?: string
  }) =>
    request<PreparedClaim>("/v1/claims/prepare", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  checkClaim: (body: { funder: string; batchId: string; nullifier: string; recipient?: string }) =>
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
  claimUrl: string
}


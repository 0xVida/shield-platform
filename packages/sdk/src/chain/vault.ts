import { rpc } from "@stellar/stellar-sdk"
import type {
  AssembledTransaction,
  ClientOptions,
  Result,
} from "@stellar/stellar-sdk/contract"

import {
  assertAmount,
  assertBatchId,
  bytes32ToField,
  fieldToBytes32,
} from "./encoding"
import { toVaultError } from "./errors"
import { parseVaultEvent, type VaultEventPage } from "./events"
import { Client } from "./vault-bindings"

/** Where the vault lives. The contract id comes from config, never from code. */
export type VaultConnection = Pick<
  ClientOptions,
  "contractId" | "networkPassphrase" | "rpcUrl" | "allowHttp"
>

/** A funded batch, as stored by the vault. */
export interface VaultBatch {
  /** Merkle root of the batch's allocation commitments. */
  root: bigint
  /** Token contract the batch was funded in. */
  token: string
  /** Amount deposited, in token base units. */
  total: bigint
  /** Amount paid out so far. Never exceeds `total`. */
  withdrawn: bigint
}

export interface FundBatchParams {
  /** Account that pays `total` and signs the transaction. */
  funder: string
  batchId: bigint
  token: string
  root: bigint
  /** Amount to deposit, in token base units. */
  total: bigint
  /** Conservation proof for the public inputs [root, total, batchId]. */
  proof: Uint8Array
}

export interface WithdrawParams {
  /**
   * Account that submits the transaction and pays its fee: the recipient, or a
   * relayer. The proof binds the payout to `recipient` either way. Defaults to
   * `recipient`.
   */
  source?: string
  /** The batch's funder: batch ids are per funder, so a batch is (funder, batchId). */
  funder: string
  batchId: bigint
  /** Withdraw proof for the public inputs [root, nullifier, recipient, amount]. */
  proof: Uint8Array
  nullifier: bigint
  recipient: string
  /** Payout, in token base units. */
  amount: bigint
}

/** A simulated vault call, ready to be signed and sent. */
export type VaultTransaction = AssembledTransaction<Result<void>>

/** A transaction's outcome, as the RPC reports it. */
export type TransactionOutcome =
  | { status: "SUCCESS" | "FAILED"; ledger: number; ledgerClosedAt: string }
  | { status: "NOT_FOUND" }

/**
 * Typed access to the ShieldVault contract.
 *
 * Reads (`getBatch`, `isNullifierUsed`) are answered by simulation and cost nothing.
 * Writes (`buildFundBatch`, `buildWithdraw`) check their inputs, simulate the call,
 * and throw a VaultContractError if the vault would reject it, so a transaction
 * that is bound to fail never reaches the wallet for signing.
 */
export class ShieldVaultClient {
  constructor(private readonly connection: VaultConnection) {}

  /** Returns `funder`'s batch with this id, or undefined if there's none. */
  async getBatch(
    funder: string,
    batchId: bigint
  ): Promise<VaultBatch | undefined> {
    assertBatchId(batchId)
    const tx = await this.client().get_batch({ funder, batch_id: batchId })
    const batch = tx.result
    if (!batch) return undefined
    return {
      root: bytes32ToField(batch.root),
      token: batch.token,
      total: batch.total,
      withdrawn: batch.withdrawn,
    }
  }

  /** True if `nullifier` has already been used to claim from `funder`'s batch. */
  async isNullifierUsed(
    funder: string,
    batchId: bigint,
    nullifier: bigint
  ): Promise<boolean> {
    assertBatchId(batchId)
    const tx = await this.client().is_nullifier_used({
      funder,
      batch_id: batchId,
      nullifier: fieldToBytes32(nullifier),
    })
    return tx.result
  }

  /** Builds and simulates `fund_batch`, signed by `funder`. */
  async buildFundBatch(params: FundBatchParams): Promise<VaultTransaction> {
    assertBatchId(params.batchId)
    if (params.total < 1n) {
      throw new RangeError(`Batch total must be positive: ${params.total}`)
    }
    const tx = await this.client(params.funder).fund_batch({
      funder: params.funder,
      batch_id: params.batchId,
      token: params.token,
      root: fieldToBytes32(params.root),
      total: params.total,
      proof: params.proof,
    })
    return checked(tx)
  }

  /** Builds and simulates `withdraw`, submitted by `source` (default: the recipient). */
  async buildWithdraw(params: WithdrawParams): Promise<VaultTransaction> {
    assertBatchId(params.batchId)
    assertAmount(params.amount)
    const tx = await this.client(params.source ?? params.recipient).withdraw({
      funder: params.funder,
      batch_id: params.batchId,
      proof: params.proof,
      nullifier: fieldToBytes32(params.nullifier),
      recipient: params.recipient,
      amount: params.amount,
    })
    return checked(tx)
  }

  /**
   * One page of the vault's events, oldest first: from a ledger, or from the
   * `cursor` of the previous page. The RPC only keeps recent ledgers (about a week
   * on testnet), so a start older than the page's `oldestLedger` can't be served.
   */
  async getEvents(
    start: { ledger: number } | { cursor: string },
    limit = 100
  ): Promise<VaultEventPage> {
    const server = this.server()
    const filters = [
      { type: "contract" as const, contractIds: [this.connection.contractId] },
    ]
    const response = await server.getEvents(
      "cursor" in start
        ? { filters, cursor: start.cursor, limit }
        : { filters, startLedger: start.ledger, limit }
    )
    const spec = this.client().spec
    return {
      events: response.events.flatMap((event) => {
        const parsed = parseVaultEvent(spec, event)
        return parsed ? [parsed] : []
      }),
      received: response.events.length,
      cursor: response.cursor,
      latestLedger: response.latestLedger,
      oldestLedger: response.oldestLedger,
    }
  }

  /**
   * A transaction's outcome, per the RPC. NOT_FOUND covers everything not in a
   * ledger the RPC keeps: still pending, never sent, expired, or older than about a
   * week. The RPC can't tell these apart.
   */
  async getTransaction(hash: string): Promise<TransactionOutcome> {
    const response = await this.server().getTransaction(hash)
    if (response.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
      return { status: "NOT_FOUND" }
    }
    return {
      status: response.status,
      ledger: response.ledger,
      // Whole seconds, written like the RPC writes events' ledgerClosedAt
      ledgerClosedAt: new Date(response.createdAt * 1000)
        .toISOString()
        .replace(".000Z", "Z"),
    }
  }

  /**
   * The ledgers the RPC can serve events for. getEvents rejects a start ledger
   * outside this range.
   */
  async getLedgerRange(): Promise<{
    oldestLedger: number
    latestLedger: number
  }> {
    const { oldestLedger, latestLedger } = await this.server().getHealth()
    return { oldestLedger, latestLedger }
  }

  /** Bindings client whose transactions use `publicKey` as the source account. */
  private client(publicKey?: string): Client {
    return new Client({ ...this.connection, publicKey })
  }

  private server(): rpc.Server {
    return new rpc.Server(this.connection.rpcUrl, {
      allowHttp: this.connection.allowHttp,
    })
  }
}

/** Returns `tx`, or throws if its simulation shows the vault would reject it. */
function checked(tx: VaultTransaction): VaultTransaction {
  const result = tx.result
  if (result.isErr()) {
    const simulation = tx.simulation
    const detail =
      simulation && "error" in simulation ? simulation.error : undefined
    throw toVaultError(detail) ?? new Error(result.unwrapErr().message)
  }
  return tx
}

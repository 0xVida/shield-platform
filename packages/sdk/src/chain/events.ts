import type { rpc } from "@stellar/stellar-sdk"
import type { Spec } from "@stellar/stellar-sdk/contract"

import { bytes32ToField } from "./encoding"

/** Where and when an event happened. All of it is public on-chain. */
export interface VaultEventMeta {
  /** The RPC's event id: unique, and ordered like the events themselves. */
  id: string
  /** The vault that emitted the event. */
  contractId: string
  ledger: number
  /** ISO 8601, as the RPC reports it. */
  ledgerClosedAt: string
  txHash: string
}

/** `BatchFunded`: fund_batch registered a batch and pulled its total. */
export interface BatchFundedEvent extends VaultEventMeta {
  type: "funded"
  batchId: bigint
  funder: string
  token: string
  root: bigint
  total: bigint
}

/** `Withdrawn`: withdraw paid out a claim and spent its nullifier. */
export interface WithdrawnEvent extends VaultEventMeta {
  type: "withdrawn"
  batchId: bigint
  nullifier: bigint
  recipient: string
  amount: bigint
}

export type VaultEvent = BatchFundedEvent | WithdrawnEvent

/** One page of a vault's events, oldest first. */
export interface VaultEventPage {
  events: VaultEvent[]
  /**
   * How many events the RPC returned, including ones skipped as unknown. Fewer than
   * the limit asked for means the page reached the latest ledger.
   */
  received: number
  /** Where the next page starts: pass it back as `{ cursor }`. */
  cursor: string
  /** The newest ledger the RPC has. */
  latestLedger: number
  /** The oldest ledger the RPC still has events for. Older events are gone. */
  oldestLedger: number
}

/**
 * Decodes one RPC event with the vault's contract spec. Returns undefined for an
 * event this code doesn't know, e.g. one added by a newer vault, so it can be skipped.
 */
export function parseVaultEvent(
  spec: Spec,
  event: rpc.Api.EventResponse
): VaultEvent | undefined {
  // Since protocol 23 failed calls emit no events, and newer RPCs drop this field,
  // so only an explicit false means the event didn't take effect
  if (event.inSuccessfulContractCall === false) return undefined
  const parsed = spec.parseEvent(event.topic, event.value)
  if (!parsed || !event.contractId) return undefined

  const meta: VaultEventMeta = {
    id: event.id,
    contractId: event.contractId.contractId(),
    ledger: event.ledger,
    ledgerClosedAt: event.ledgerClosedAt,
    txHash: event.txHash,
  }
  const data = parsed.data
  switch (parsed.name) {
    case "BatchFunded":
      return {
        ...meta,
        type: "funded",
        batchId: BigInt(data.batch_id),
        funder: data.funder,
        token: data.token,
        root: bytes32ToField(data.root),
        total: BigInt(data.total),
      }
    case "Withdrawn":
      return {
        ...meta,
        type: "withdrawn",
        batchId: BigInt(data.batch_id),
        nullifier: bytes32ToField(data.nullifier),
        recipient: data.recipient,
        amount: BigInt(data.amount),
      }
    default:
      return undefined
  }
}

import { formatAmount } from "./amount"
import { networkName } from "./wallet"

/** One line of a transaction review: what the wallet is about to sign. */
export type ReviewLine = {
  label: string
  value: string
  /** Shown in full on hover: addresses and ids are shortened. */
  full?: string
}

/** `GCJA…N2FC`: enough to recognise an address, short enough to read. */
export function shortAddress(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 4)}…${address.slice(-4)}`
    : address
}

/**
 * The most the network can charge for a built transaction: its fee in stroops (the
 * inclusion fee plus the simulated resource fee). Unused resource fee is refunded,
 * so the actual charge is usually less.
 */
export function maxFee(tx: { built?: { fee: string } }): string | undefined {
  return tx.built ? `${formatAmount(BigInt(tx.built.fee))} XLM` : undefined
}

function address(label: string, value: string): ReviewLine {
  return { label, value: shortAddress(value), full: value }
}

function common(networkPassphrase: string, vault: string, fee?: string) {
  return [
    address("Vault contract", vault),
    { label: "Network", value: networkName(networkPassphrase) },
    ...(fee ? [{ label: "Maximum network fee", value: fee }] : []),
  ]
}

/** What a disburser signs to fund a batch. */
export function fundingReview(r: {
  batchId: string
  total: bigint
  token: string
  funder: string
  vault: string
  networkPassphrase: string
  fee?: string
}): ReviewLine[] {
  return [
    { label: "Action", value: `Fund batch ${r.batchId}` },
    { label: "Deposit", value: `${formatAmount(r.total)} tokens` },
    address("Token contract", r.token),
    address("Paid from", r.funder),
    ...common(r.networkPassphrase, r.vault, r.fee),
  ]
}

/**
 * What a claimant signs to claim an allocation. The submitter pays the fee; the
 * proof binds the payout to the recipient, whoever submits.
 */
export function claimReview(r: {
  batchId: string
  amount: bigint
  recipient: string
  submitter: string
  vault: string
  networkPassphrase: string
  fee?: string
}): ReviewLine[] {
  return [
    { label: "Action", value: `Claim from batch ${r.batchId}` },
    { label: "Payout", value: `${formatAmount(r.amount)} tokens` },
    address("Paid to", r.recipient),
    address("Fee paid by", r.submitter),
    ...common(r.networkPassphrase, r.vault, r.fee),
  ]
}

import { formatAmount } from "./amount"
import type { ActivityItem, ActivityPage } from "./api"

/** The activity filters the page offers, from its URL. */
export type ActivityFilters = {
  type?: ActivityItem["type"]
  /** Only this funder's or recipient's events: a Stellar address. */
  address?: string
}

/** Reads the filters from the page's URL (?type=funded|withdrawn&address=G...). */
export function filtersFromSearch(search: URLSearchParams): ActivityFilters {
  const type = search.get("type")
  const address = search.get("address")?.trim()
  return {
    type: type === "funded" || type === "withdrawn" ? type : undefined,
    address: address || undefined,
  }
}

/** One row of the activity list, in words. */
export type ActivityRow = {
  key: string
  title: string
  amount: string
  batchId: string
  /** Who funded the batch, or who the claim paid out to. */
  party: { label: string; address: string }
  when: string
  txHash: string
}

export function activityRow(item: ActivityItem): ActivityRow {
  const common = {
    key: item.id,
    batchId: item.batchId,
    when: item.ledgerClosedAt,
    txHash: item.txHash,
  }
  return item.type === "funded"
    ? {
        ...common,
        title: "Batch funded",
        amount: `${formatAmount(BigInt(item.total))} tokens`,
        party: { label: "Funded by", address: item.funder },
      }
    : {
        ...common,
        title: "Claim paid",
        amount: `${formatAmount(BigInt(item.amount))} tokens`,
        party: { label: "Paid to", address: item.recipient },
      }
}

/**
 * Why the list may be incomplete, or undefined when it's complete: the indexer
 * hasn't run yet, or it missed ledgers the RPC had already dropped.
 */
export function historyWarning(
  indexer: ActivityPage["indexer"]
): string | undefined {
  if (!indexer) {
    return "The indexer hasn't read the vault yet, so recent activity may be missing."
  }
  if (indexer.gaps.length === 0) return undefined
  const ranges = indexer.gaps
    .map((gap) =>
      gap.fromLedger === gap.toLedger
        ? `${gap.fromLedger}`
        : `${gap.fromLedger}–${gap.toLedger}`
    )
    .join(", ")
  return `History may be incomplete: ledgers ${ranges} weren't indexed before the network dropped them.`
}

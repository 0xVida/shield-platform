import { useEffect, useState } from "react"
import { Link } from "react-router"
import {
  ArrowSquareOut,
  ArrowsClockwise,
  ClockCounterClockwise,
  Coins,
  HandCoins,
  WarningCircle,
} from "@phosphor-icons/react"
import { Button } from "@workspace/ui/components/button"

import type { Route } from "./+types/activity"
import { AppHeader } from "../components/app-header"
import { ErrorBox } from "../components/error-box"
import { useWallet } from "../context/wallet-context"
import { activityRow, filtersFromSearch, historyWarning } from "../lib/activity"
import { ApiError, api, type ActivityItem, type ActivityPage } from "../lib/api"
import { explorerUrl } from "../lib/explorer"
import { shortAddress } from "../lib/tx-review"
import { APP_NETWORK_PASSPHRASE } from "../lib/wallet"

const PAGE_SIZE = 20

export function meta() {
  return [{ title: "Activity · ShieldZK" }]
}

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const filters = filtersFromSearch(new URL(request.url).searchParams)
  try {
    const [page, config] = await Promise.all([
      api.activity({ ...filters, limit: PAGE_SIZE }),
      api.config(),
    ])
    const network = config.vault?.networkPassphrase ?? APP_NETWORK_PASSPHRASE
    return { page, filters, network, error: null }
  } catch (err) {
    const error =
      err instanceof ApiError && err.status === 503
        ? "The API has no vault configured, so there's no activity to show."
        : err instanceof Error
          ? err.message
          : "Couldn't reach the API"
    return { page: null, filters, network: APP_NETWORK_PASSPHRASE, error }
  }
}

export function HydrateFallback() {
  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 antialiased transition-colors">
      <AppHeader />
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <div className="inline-flex items-center gap-2.5 text-xs text-neutral-600 dark:text-neutral-400 py-3 px-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 shadow-xs">
          <ArrowsClockwise size={16} className="animate-spin text-emerald-500" />
          Loading vault activity...
        </div>
      </div>
    </div>
  )
}

const TYPE_FILTERS: { label: string; type?: ActivityItem["type"] }[] = [
  { label: "All" },
  { label: "Fundings", type: "funded" },
  { label: "Claims", type: "withdrawn" },
]

export default function Activity({ loaderData }: Route.ComponentProps) {
  const { page, filters, network, error } = loaderData
  const { address: walletAddress } = useWallet()
  const [items, setItems] = useState<ActivityItem[]>(page?.items ?? [])
  const [next, setNext] = useState<string | null>(page?.next ?? null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<string>()

  // A new filter loads a new first page
  useEffect(() => {
    setItems(page?.items ?? [])
    setNext(page?.next ?? null)
    setMoreError(undefined)
  }, [page])

  async function loadMore() {
    if (!next) return
    setLoadingMore(true)
    setMoreError(undefined)
    try {
      const more: ActivityPage = await api.activity({
        ...filters,
        before: next,
        limit: PAGE_SIZE,
      })
      setItems((shown) => [...shown, ...more.items])
      setNext(more.next)
    } catch (err) {
      setMoreError(err instanceof Error ? err.message : "Couldn't load more")
    } finally {
      setLoadingMore(false)
    }
  }

  /** A link to this page with one filter changed. */
  function withFilters(change: Partial<typeof filters>) {
    const merged = { ...filters, ...change }
    const params = new URLSearchParams()
    if (merged.type) params.set("type", merged.type)
    if (merged.address) params.set("address", merged.address)
    const search = params.toString()
    return search ? `/activity?${search}` : "/activity"
  }

  const warning = page ? historyWarning(page.indexer) : undefined
  const onlyMine = !!walletAddress && filters.address === walletAddress

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 antialiased selection:bg-emerald-500/30 selection:text-emerald-300 transition-colors">
      <AppHeader />

      <main className="mx-auto max-w-3xl px-4 py-12">
        <div className="mb-10 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-1 text-xs font-medium text-neutral-700 dark:text-neutral-300 shadow-xs">
            <ClockCounterClockwise size={14} className="text-emerald-600 dark:text-emerald-400" />
            On-chain History
          </div>
          <h1 className="mb-2 text-3xl font-bold tracking-tight text-neutral-900 dark:text-white sm:text-4xl">
            Vault Activity
          </h1>
          <p className="mx-auto max-w-lg text-sm text-neutral-600 dark:text-neutral-400">
            Every batch funded and every claim paid, as the vault recorded them.
            Only what's public on-chain: nothing here says which allocation a
            claim was.
          </p>
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {TYPE_FILTERS.map((f) => (
              <FilterLink
                key={f.label}
                to={withFilters({ type: f.type })}
                active={filters.type === f.type}
              >
                {f.label}
              </FilterLink>
            ))}
          </div>
          {walletAddress && (
            <FilterLink
              to={withFilters({
                address: onlyMine ? undefined : walletAddress,
              })}
              active={onlyMine}
            >
              Only my wallet ({shortAddress(walletAddress)})
            </FilterLink>
          )}
        </div>

        {filters.address && !onlyMine && (
          <p className="mb-3 text-[11px] text-neutral-400">
            Showing activity for{" "}
            <span className="font-mono text-neutral-200">
              {shortAddress(filters.address)}
            </span>
            .{" "}
            <Link
              to={withFilters({ address: undefined })}
              className="text-emerald-400 hover:text-emerald-300"
            >
              Show everyone's
            </Link>
          </p>
        )}

        {warning && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-900/50 bg-amber-950/30 p-3 text-xs text-amber-300">
            <WarningCircle size={16} className="mt-0.5 shrink-0" />
            {warning}
          </div>
        )}

        {error ? (
          <ErrorBox title="Couldn't load activity">{error}</ErrorBox>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-neutral-900/80 p-10 text-center shadow-xs">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <ClockCounterClockwise size={24} weight="duotone" />
            </div>
            <p className="mb-1 text-sm font-semibold text-neutral-900 dark:text-white">
              No activity yet
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {filters.type || filters.address
                ? "Nothing matches these filters."
                : "Funded batches and paid claims will show up here."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/80 overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-neutral-900/80 shadow-xs">
            {items.map((item) => {
              const row = activityRow(item)
              const href = explorerUrl(network, "tx", row.txHash)
              return (
                <li
                  key={row.key}
                  className="flex items-center justify-between gap-4 p-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                      {item.type === "funded" ? (
                        <Coins size={18} />
                      ) : (
                        <HandCoins size={18} />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white">
                        {row.title}
                      </div>
                      <div className="truncate font-mono text-[11px] text-neutral-500">
                        Batch #{row.batchId} · {row.party.label}{" "}
                        <span title={row.party.address}>
                          {shortAddress(row.party.address)}
                        </span>{" "}
                        · {new Date(row.when).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-mono text-sm font-medium text-emerald-400">
                      {row.amount}
                    </span>
                    {href && (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View on Stellar Expert"
                        className="text-neutral-500 transition-colors hover:text-emerald-400"
                      >
                        <ArrowSquareOut size={16} />
                      </a>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {moreError && <p className="mt-3 text-xs text-red-300">{moreError}</p>}
        {next && (
          <div className="mt-4 flex justify-center">
            <Button
              variant="outline"
              disabled={loadingMore}
              onClick={loadMore}
              className="cursor-pointer border-neutral-800 text-neutral-300 hover:bg-neutral-800"
            >
              {loadingMore && (
                <ArrowsClockwise size={16} className="animate-spin" />
              )}
              Load more
            </Button>
          </div>
        )}
      </main>
    </div>
  )
}

function FilterLink({
  to,
  active,
  children,
}: {
  to: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      to={to}
      className={`rounded-md border px-2.5 py-1 text-xs transition-colors shadow-2xs ${
        active
          ? "border-emerald-300 dark:border-emerald-800/60 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-300 font-semibold"
          : "border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/40 text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:border-neutral-300"
      }`}
    >
      {children}
    </Link>
  )
}

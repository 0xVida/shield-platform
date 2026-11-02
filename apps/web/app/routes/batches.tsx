import { Link } from "react-router"
import {
  ArrowRight,
  ArrowsClockwise,
  LockKey,
  Plus,
  Stack,
} from "@phosphor-icons/react"

import type { Route } from "./+types/batches"
import { BatchStatusPill, STATUS_FILTERS } from "../components/batch-status"
import { AppHeader } from "../components/app-header"
import { ErrorBox } from "../components/error-box"
import { formatAmount } from "../lib/amount"
import { api, type Batch } from "../lib/api"

export function meta() {
  return [{ title: "Batches · ShieldZK" }]
}

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const param = new URL(request.url).searchParams.get("status")
  const status = STATUS_FILTERS.find((f) => f.status && f.status === param)?.status
  try {
    const { batches } = await api.listBatches(status)
    return { batches, status, error: null }
  } catch (err) {
    const error = err instanceof Error ? err.message : "Couldn't reach the API"
    return { batches: [] as Batch[], status, error }
  }
}

export function HydrateFallback() {
  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 antialiased transition-colors">
      <AppHeader />
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <div className="inline-flex items-center gap-2.5 text-xs text-neutral-600 dark:text-neutral-400 py-3 px-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 shadow-xs">
          <ArrowsClockwise size={16} className="animate-spin text-emerald-500" />
          Loading confidential batches...
        </div>
      </div>
    </div>
  )
}

export default function Batches({ loaderData }: Route.ComponentProps) {
  const { batches, status, error } = loaderData

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 antialiased selection:bg-emerald-500/30 selection:text-emerald-300 transition-colors">
      <AppHeader />

      <main className="max-w-3xl mx-auto px-4 py-12">
        {/* Title & Subtitle */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 text-xs font-medium mb-3 shadow-xs">
            <Stack size={14} className="text-emerald-600 dark:text-emerald-400" />
            Disburser Console
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-neutral-900 dark:text-white mb-2">
            Confidential Batches
          </h1>
          <p className="text-neutral-600 dark:text-neutral-400 text-sm max-w-lg mx-auto">
            Each batch hides what every recipient gets. Only its total and Merkle root
            are public, and a zero-knowledge proof shows the amounts add up.
          </p>
        </div>

        {/* Filters & New */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((f) => {
              const active = f.status === status
              return (
                <Link
                  key={f.label}
                  to={f.status ? `/batches?status=${f.status}` : "/batches"}
                  className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                    active
                      ? "bg-emerald-100 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-300 font-semibold"
                      : "bg-white dark:bg-neutral-900/40 border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-400 hover:text-neutral-950 dark:hover:text-white hover:border-neutral-300 shadow-2xs"
                  }`}
                >
                  {f.label}
                </Link>
              )
            })}
          </div>
          <Link
            to="/batches/new"
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-4 py-2 rounded-lg text-sm inline-flex items-center gap-1.5 transition-colors shadow-xs"
          >
            <Plus size={16} />
            New Batch
          </Link>
        </div>

        {error ? (
          <ErrorBox title="Couldn't load batches">{error}</ErrorBox>
        ) : batches.length === 0 ? (
          <div className="bg-white dark:bg-neutral-900/80 border border-neutral-200 dark:border-neutral-800/80 rounded-2xl p-10 text-center shadow-xs">
            <div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 mx-auto mb-3">
              <LockKey size={24} weight="duotone" />
            </div>
            <p className="text-sm font-semibold text-neutral-900 dark:text-white mb-1">
              {status ? "No batches with this status" : "No batches yet"}
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Create one from a list of recipients and amounts.
            </p>
          </div>
        ) : (
          <ul className="bg-white dark:bg-neutral-900/80 border border-neutral-200 dark:border-neutral-800/80 rounded-2xl divide-y divide-neutral-100 dark:divide-neutral-800/80 overflow-hidden shadow-xs">
            {batches.map((batch) => (
              <li key={batch.batchId}>
                <Link
                  to={`/batches/${batch.batchId}`}
                  className="flex items-center justify-between gap-4 p-4 hover:bg-neutral-50 dark:hover:bg-neutral-900/90 transition-colors group"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-neutral-900 dark:text-white truncate">
                        {batch.name ?? `Batch ${batch.batchId}`}
                      </span>
                      <BatchStatusPill status={batch.status} />
                    </div>
                    <div className="text-[11px] text-neutral-500 dark:text-neutral-400 font-mono">
                      #{batch.batchId} · {batch.recipientCount} recipient
                      {batch.recipientCount === 1 ? "" : "s"} ·{" "}
                      {new Date(batch.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-mono text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                      {formatAmount(BigInt(batch.total))}
                    </span>
                    <ArrowRight
                      size={16}
                      className="text-neutral-400 group-hover:text-neutral-700 dark:text-neutral-600 dark:group-hover:text-neutral-300 transition-colors"
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

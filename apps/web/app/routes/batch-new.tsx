import { useState } from "react"
import { Link, redirect, useFetcher } from "react-router"
import {
  ArrowLeft,
  ArrowRight,
  ArrowsClockwise,
  FileArrowUp,
  Plus,
  Receipt,
  Trash,
} from "@phosphor-icons/react"
import { Button } from "@workspace/ui/components/button"
import { MAX_ALLOCATIONS, MAX_AMOUNT } from "@workspace/sdk"

import type { Route } from "./+types/batch-new"
import { AppHeader } from "../components/app-header"
import { ErrorBox } from "../components/error-box"
import { formatAmount, parseAmount } from "../lib/amount"
import { ApiError, api } from "../lib/api"
import { parseRecipientsCsv, type RecipientRow } from "../lib/csv"

export function meta() {
  return [{ title: "New batch · ShieldZK" }]
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  try {
    const batch = await api.createBatch(await request.json())
    return redirect(`/batches/${batch.batchId}`)
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message }
    throw err
  }
}

const EMPTY: RecipientRow = { recipient: "", amount: "" }

const input =
  "w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"

/** Problems with the filled-in rows, as the API would see them. */
function check(rows: RecipientRow[]): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  rows.forEach(({ recipient, amount }, i) => {
    const r = recipient.trim()
    const value = parseAmount(amount)
    if (r === "" || r.length > 256) {
      problems.push(`Row ${i + 1}: the recipient must be 1 to 256 characters`)
    } else if (seen.has(r)) {
      problems.push(`Row ${i + 1}: ${r} is already listed`)
    }
    seen.add(r)
    if (value === undefined || value > MAX_AMOUNT) {
      problems.push(
        `Row ${i + 1}: the amount must be a positive number of tokens, with at most 7 decimals`
      )
    }
  })
  if (rows.length > MAX_ALLOCATIONS) {
    problems.push(`A batch holds at most ${MAX_ALLOCATIONS} recipients`)
  }
  return problems
}

export default function NewBatch() {
  const fetcher = useFetcher<typeof clientAction>()
  const [name, setName] = useState("")
  const [rows, setRows] = useState<RecipientRow[]>([EMPTY])
  const [csvErrors, setCsvErrors] = useState<string[]>([])

  const filled = rows.filter((r) => r.recipient.trim() || r.amount.trim())
  const problems = check(filled)
  const total = filled.reduce((sum, r) => sum + (parseAmount(r.amount) ?? 0n), 0n)
  const submitting = fetcher.state !== "idle"
  const error = fetcher.data?.error

  function update(i: number, change: Partial<RecipientRow>) {
    setRows(rows.map((row, j) => (j === i ? { ...row, ...change } : row)))
  }

  async function upload(file: File) {
    const { rows: parsed, errors } = parseRecipientsCsv(await file.text())
    setCsvErrors(errors)
    // A file with errors replaces nothing, so no recipient is silently dropped
    if (errors.length === 0 && parsed.length > 0) setRows(parsed)
  }

  function submit() {
    fetcher.submit(
      {
        ...(name.trim() && { name: name.trim() }),
        allocations: filled.map((r) => ({
          recipient: r.recipient.trim(),
          amount: parseAmount(r.amount)!.toString(),
        })),
      },
      { method: "post", encType: "application/json" }
    )
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 antialiased selection:bg-emerald-500/30 selection:text-emerald-300">
      <AppHeader />

      <main className="max-w-3xl mx-auto px-4 py-12">
        <Link
          to="/batches"
          className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition-colors mb-6"
        >
          <ArrowLeft size={14} />
          Batches
        </Link>

        <div className="text-center mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-2">
            New Confidential Batch
          </h1>
          <p className="text-neutral-400 text-sm max-w-lg mx-auto">
            Each allocation gets its own secret and a Poseidon commitment. The amounts
            stay private; only the total and the batch's Merkle root are published.
          </p>
        </div>

        <div className="bg-neutral-900/80 border border-neutral-800/80 rounded-2xl p-6 sm:p-8">

          {error && (
            <ErrorBox title="Batch not created" className="mb-6">
              {error}
            </ErrorBox>
          )}

          <div className="space-y-6">
            <div>
              <label htmlFor="name" className="block text-xs font-medium text-neutral-300 mb-1.5">
                Batch name (optional)
              </label>
              <input
                id="name"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                className={input}
                placeholder="October stipends"
              />
            </div>

            <div className="flex items-center justify-between pb-4 border-b border-neutral-800">
              <div>
                <h2 className="text-base font-semibold text-white">Recipients</h2>
                <p className="text-xs text-neutral-400">
                  Amounts in tokens, up to 7 decimals. Up to {MAX_ALLOCATIONS} recipients.
                </p>
              </div>
              <label className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1.5 transition-colors font-medium bg-emerald-950/40 border border-emerald-800/40 px-2.5 py-1 rounded-md cursor-pointer">
                <FileArrowUp size={13} />
                Upload CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void upload(file)
                    e.target.value = ""
                  }}
                />
              </label>
            </div>

            {csvErrors.length > 0 && (
              <ErrorBox title="The CSV wasn't loaded. Fix these lines and upload it again:">
                <ul className="space-y-0.5">
                  {csvErrors.slice(0, 8).map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                  {csvErrors.length > 8 && <li>…and {csvErrors.length - 8} more</li>}
                </ul>
              </ErrorBox>
            )}

            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_9rem_2rem] gap-2 text-[11px] font-medium text-neutral-500 px-1">
                <span>Recipient</span>
                <span>Amount</span>
                <span />
              </div>
              {rows.map((row, i) => (
                <div key={i} className="grid grid-cols-[1fr_9rem_2rem] gap-2 items-center">
                  <input
                    aria-label={`Recipient ${i + 1}`}
                    value={row.recipient}
                    onChange={(e) => update(i, { recipient: e.target.value })}
                    className={`${input} font-mono text-xs`}
                    placeholder="G... or recipient ID"
                  />
                  <input
                    aria-label={`Amount ${i + 1}`}
                    value={row.amount}
                    inputMode="decimal"
                    onChange={(e) => update(i, { amount: e.target.value })}
                    className={`${input} font-mono font-medium text-emerald-400`}
                    placeholder="0.00"
                  />
                  <button
                    type="button"
                    aria-label={`Remove row ${i + 1}`}
                    disabled={rows.length === 1}
                    onClick={() => setRows(rows.filter((_, j) => j !== i))}
                    className="h-9 flex items-center justify-center rounded-lg text-neutral-500 hover:text-red-300 hover:bg-red-950/40 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-500 cursor-pointer"
                  >
                    <Trash size={15} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                disabled={rows.length >= MAX_ALLOCATIONS}
                onClick={() => setRows([...rows, EMPTY])}
                className="text-xs text-neutral-300 hover:text-white flex items-center gap-1.5 bg-neutral-800/80 px-2.5 py-1.5 rounded-md transition-colors cursor-pointer disabled:opacity-50"
              >
                <Plus size={13} />
                Add recipient
              </button>
            </div>

            {/* Summary */}
            <div className="p-4 rounded-xl bg-neutral-950/60 border border-neutral-800/80 text-xs space-y-2">
              <div className="text-neutral-400 flex items-center gap-2">
                <Receipt size={16} className="text-emerald-400" />
                <span>Batch summary:</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-neutral-300 pt-1 font-mono text-[11px]">
                <div>
                  <span className="text-neutral-500 block">Recipients:</span> {filled.length}
                </div>
                <div>
                  <span className="text-neutral-500 block">Total (public):</span>
                  <span className="text-emerald-400 font-semibold">
                    {formatAmount(total)} tokens
                  </span>
                </div>
              </div>
            </div>

            {filled.length > 0 && problems.length > 0 && (
              <ul className="text-xs text-amber-300 space-y-0.5">
                {problems.slice(0, 5).map((p) => (
                  <li key={p}>{p}</li>
                ))}
                {problems.length > 5 && <li>…and {problems.length - 5} more</li>}
              </ul>
            )}

            <div className="pt-2 flex justify-end">
              <Button
                disabled={submitting || filled.length === 0 || problems.length > 0}
                onClick={submit}
                className="bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold px-5 flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <ArrowsClockwise size={16} className="animate-spin" />
                    Creating Batch...
                  </>
                ) : (
                  <>
                    Create Batch
                    <ArrowRight size={16} />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

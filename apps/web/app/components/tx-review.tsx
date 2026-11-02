import { ArrowsClockwise, Eye } from "@phosphor-icons/react"
import { Button } from "@workspace/ui/components/button"

import type { ReviewLine } from "../lib/tx-review"

/**
 * What a transaction will do, shown before the wallet opens, so nothing is signed
 * unseen. The lines come from lib/tx-review.
 */
export function TxReview({
  title,
  lines,
  confirmLabel,
  onConfirm,
  onCancel,
  busy = false,
}: {
  title: string
  lines: ReviewLine[]
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}) {
  return (
    <section
      aria-label={title}
      className="space-y-3 rounded-xl border border-emerald-900/50 bg-neutral-950 p-4"
    >
      <div>
        <h3 className="flex items-center gap-2 text-xs font-semibold text-white">
          <Eye size={15} className="text-emerald-400" />
          {title}
        </h3>
        <p className="mt-1 text-[11px] text-neutral-400">
          Check this before your wallet opens: it's exactly what you'll be asked
          to sign.
        </p>
      </div>

      <dl className="divide-y divide-neutral-900 text-xs">
        {lines.map((line) => (
          <div key={line.label} className="flex justify-between gap-4 py-1.5">
            <dt className="text-neutral-500">{line.label}</dt>
            <dd
              className="text-right font-mono break-all text-neutral-200"
              title={line.full}
            >
              {line.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex justify-end gap-2 pt-1">
        <Button
          variant="outline"
          disabled={busy}
          onClick={onCancel}
          className="cursor-pointer border-neutral-800 text-neutral-300 hover:bg-neutral-800"
        >
          Cancel
        </Button>
        <Button
          disabled={busy}
          onClick={onConfirm}
          className="flex cursor-pointer items-center gap-2 bg-emerald-500 px-5 font-semibold text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {busy && <ArrowsClockwise size={16} className="animate-spin" />}
          {confirmLabel}
        </Button>
      </div>
    </section>
  )
}

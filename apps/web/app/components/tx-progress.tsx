import {
  ArrowSquareOut,
  CheckCircle,
  Circle,
  CircleNotch,
  XCircle,
} from "@phosphor-icons/react"
import type { SubmitStage } from "@workspace/sdk/chain"

/** Where a transaction is: submitTransaction's stages, then "done". */
export type TxStage = SubmitStage | "done"

const STEPS: { stage: TxStage; label: string }[] = [
  { stage: "signing", label: "Confirm in your wallet" },
  { stage: "submitting", label: "Sending to the network" },
  { stage: "confirming", label: "Waiting for confirmation" },
  { stage: "done", label: "Confirmed" },
]

/** The words for a stage, e.g. for a busy button. */
export function stageLabel(stage: TxStage): string {
  return STEPS.find((step) => step.stage === stage)!.label
}

/**
 * A transaction's progress, step by step. `stage` is the furthest it got; with
 * `failed`, that step is where it stopped. The explorer link appears as soon as the
 * hash is known.
 */
export function TxProgress({
  stage,
  failed = false,
  explorerHref,
}: {
  stage: TxStage
  failed?: boolean
  /** Link to the transaction, once it has a hash and the network has an explorer. */
  explorerHref?: string
}) {
  const reached = STEPS.findIndex((step) => step.stage === stage)

  return (
    <div className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-950 p-4">
      <ol className="space-y-2 text-xs">
        {STEPS.map((step, i) => {
          const state =
            i < reached || (i === reached && stage === "done")
              ? "done"
              : i === reached
                ? failed
                  ? "failed"
                  : "current"
                : "upcoming"
          return (
            <li
              key={step.stage}
              data-state={state}
              className={`flex items-center gap-2 ${
                state === "upcoming"
                  ? "text-neutral-500"
                  : state === "failed"
                    ? "text-red-300"
                    : "text-neutral-200"
              }`}
            >
              {state === "done" && (
                <CheckCircle
                  size={16}
                  weight="fill"
                  className="text-emerald-400"
                />
              )}
              {state === "current" && (
                <CircleNotch
                  size={16}
                  className="animate-spin text-emerald-400"
                />
              )}
              {state === "failed" && (
                <XCircle size={16} weight="fill" className="text-red-400" />
              )}
              {state === "upcoming" && <Circle size={16} />}
              {step.label}
            </li>
          )
        })}
      </ol>

      {explorerHref && (
        <a
          href={explorerHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300"
        >
          View the transaction on Stellar Expert
          <ArrowSquareOut size={13} />
        </a>
      )}
    </div>
  )
}

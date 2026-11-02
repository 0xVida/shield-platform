import type { Icon } from "@phosphor-icons/react"

export type Step = { title: string; icon: Icon }

/**
 * Where a flow is: steps before `current` are done, later ones are still to come.
 * With `onSelect`, a done step can be clicked to go back to it.
 */
export function StepIndicator({
  steps,
  current,
  onSelect,
}: {
  steps: Step[]
  /** 1-based. */
  current: number
  onSelect?: (step: number) => void
}) {
  return (
    <ol className="grid gap-2 mb-8" style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }}>
      {steps.map(({ title, icon: Icon }, i) => {
        const num = i + 1
        const isActive = current === num
        const isDone = current > num
        const canGoBack = isDone && !!onSelect
        return (
          <li
            key={title}
            onClick={canGoBack ? () => onSelect(num) : undefined}
            className={`p-3 rounded-xl border text-center transition-colors shadow-2xs ${
              isDone
                ? `bg-emerald-50 dark:bg-neutral-900/60 border-emerald-300 dark:border-emerald-500/40 text-emerald-800 dark:text-emerald-400 ${canGoBack ? "cursor-pointer" : ""}`
                : isActive
                  ? "bg-white dark:bg-neutral-900 border-emerald-600 dark:border-emerald-500 text-neutral-950 dark:text-white shadow-xs"
                  : "bg-white/40 dark:bg-neutral-900/20 border-neutral-200 dark:border-neutral-800/60 text-neutral-400 dark:text-neutral-500"
            }`}
          >
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Icon size={16} weight={isActive ? "duotone" : "regular"} />
              <span className="text-xs font-medium">Step {num}</span>
            </div>
            <div className="text-[11px] font-medium tracking-tight truncate">{title}</div>
          </li>
        )
      })}
    </ol>
  )
}

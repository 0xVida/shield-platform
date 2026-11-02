import { WarningCircle } from "@phosphor-icons/react"

/** A red box for something that went wrong, with a short title. */
export function ErrorBox({
  title,
  children,
  className = "",
}: {
  title: string
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 text-red-900 dark:text-red-300 text-xs flex items-start gap-3 shadow-2xs ${className}`}
    >
      <WarningCircle size={18} className="shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
      <div className="min-w-0 break-words">
        <span className="font-semibold block mb-0.5 text-red-950 dark:text-red-200">{title}</span>
        {children}
      </div>
    </div>
  )
}

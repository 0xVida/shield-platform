import { Sun, Moon } from "@phosphor-icons/react"
import { useTheme } from "../context/theme-context"

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === "dark"

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={`relative inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-colors cursor-pointer ${
        isDark
          ? "border-neutral-800 bg-neutral-900/80 text-neutral-300 hover:text-white hover:bg-neutral-800 hover:border-neutral-700"
          : "border-neutral-200 bg-white text-neutral-700 hover:text-neutral-950 hover:bg-neutral-100 hover:border-neutral-300 shadow-xs"
      } ${className}`}
    >
      {isDark ? (
        <Sun size={15} weight="duotone" className="text-amber-400 transition-transform duration-200 hover:rotate-45" />
      ) : (
        <Moon size={15} weight="duotone" className="text-indigo-600 transition-transform duration-200 hover:-rotate-12" />
      )}
    </button>
  )
}

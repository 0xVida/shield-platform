import { Link, NavLink } from "react-router"
import { ShieldCheck } from "@phosphor-icons/react"

import { WalletConnectButton } from "./wallet-button"
import { ThemeToggle } from "./theme-toggle"

const navClass = ({ isActive }: { isActive: boolean }) =>
  `transition-colors duration-150 font-medium ${
    isActive
      ? "text-neutral-950 dark:text-white"
      : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
  }`

/** Top navigation, the same on every page. */
export function AppHeader() {
  return (
    <header className="border-b border-neutral-200/80 dark:border-neutral-800/80 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-md sticky top-0 z-50 transition-colors">
      <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <ShieldCheck size={20} weight="duotone" />
          </div>
          <span className="font-semibold tracking-tight text-neutral-900 dark:text-white flex items-center gap-2">
            ShieldZK
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-800 dark:bg-emerald-950 dark:border-emerald-700/50 dark:text-emerald-300 font-medium">
              Testnet
            </span>
          </span>
        </Link>

        <div className="flex items-center gap-3 sm:gap-4 text-xs">
          <NavLink to="/batches" end className={navClass}>
            Batches
          </NavLink>
          <NavLink to="/activity" className={navClass}>
            Activity
          </NavLink>
          <NavLink to="/claim" className={navClass}>
            Claim
          </NavLink>
          <ThemeToggle />
          <WalletConnectButton />
        </div>
      </div>
    </header>
  )
}

import { Link, NavLink } from "react-router"
import { ShieldCheck } from "@phosphor-icons/react"

import { WalletConnectButton } from "./wallet-button"

/** Top navigation for the disburser's pages, matching the claim portal's. */
export function DisburseHeader() {
  return (
    <header className="border-b border-neutral-800/80 bg-neutral-900/40 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <ShieldCheck size={20} weight="duotone" />
          </div>
          <span className="font-semibold tracking-tight text-white flex items-center gap-2">
            ShieldZK
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-700/50 text-emerald-300 font-medium">
              Testnet
            </span>
          </span>
        </Link>

        <div className="flex items-center gap-4 text-xs">
          <NavLink
            to="/batches"
            end
            className={({ isActive }) =>
              `transition-colors duration-150 ${
                isActive ? "text-white" : "text-neutral-400 hover:text-white"
              }`
            }
          >
            Batches
          </NavLink>
          <NavLink
            to="/activity"
            className={({ isActive }) =>
              `transition-colors duration-150 ${
                isActive ? "text-white" : "text-neutral-400 hover:text-white"
              }`
            }
          >
            Activity
          </NavLink>
          <Link
            to="/claim"
            className="text-neutral-400 hover:text-white transition-colors duration-150"
          >
            Claim Portal
          </Link>
          <WalletConnectButton />
        </div>
      </div>
    </header>
  )
}

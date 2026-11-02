import { Link } from "react-router"
import { ArrowRight } from "@phosphor-icons/react"

import { AppHeader } from "../components/app-header"

export default function Home() {
  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 flex flex-col selection:bg-emerald-500/30 selection:text-emerald-300 transition-colors">
      <AppHeader />

      <main className="max-w-2xl mx-auto px-4 py-20 text-center flex-1 flex flex-col justify-center items-center">
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-neutral-900 dark:text-white mb-4">
          Confidential Disbursements on Stellar
        </h1>
        <p className="text-neutral-600 dark:text-neutral-400 text-base max-w-xl mb-10 leading-relaxed">
          Pay a batch of recipients without publishing what each one gets. Only the
          batch total is public; recipients claim with a zero-knowledge proof.
        </p>

        <div className="flex flex-wrap gap-4 justify-center">
          <Link
            to="/batches"
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-6 py-2.5 rounded-xl inline-flex items-center gap-2 text-sm transition-colors shadow-xs"
          >
            Send a Batch
            <ArrowRight size={16} />
          </Link>
          <Link
            to="/claim"
            className="px-6 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 bg-white dark:bg-transparent hover:bg-neutral-100 dark:hover:bg-neutral-900 text-sm font-medium transition-colors shadow-xs dark:shadow-none"
          >
            Claim an Allocation
          </Link>
        </div>
      </main>
    </div>
  )
}

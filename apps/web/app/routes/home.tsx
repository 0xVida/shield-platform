import { Link } from "react-router"
import { ShieldCheck, ArrowRight, LockKey, Cpu, Wallet, CheckCircle } from "@phosphor-icons/react"
import { Button } from "@workspace/ui/components/button"
import { TESTNET_CONFIG } from "@workspace/sdk"

import { WalletConnectButton } from "../components/wallet-button"

export default function Home() {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col justify-between selection:bg-emerald-500/30 selection:text-emerald-300">
      {/* Header */}
      <header className="border-b border-neutral-800/80 bg-neutral-900/30 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <ShieldCheck size={20} weight="duotone" />
            </div>
            <span className="font-semibold tracking-tight text-white">
              ShieldZK
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              to="/batches"
              className="text-xs text-neutral-400 hover:text-white transition-colors"
            >
              Batches
            </Link>
            <Link
              to="/claim"
              className="text-xs text-neutral-400 hover:text-white transition-colors"
            >
              Claim Portal
            </Link>
            <WalletConnectButton />
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="max-w-4xl mx-auto px-4 py-20 text-center flex-1 flex flex-col justify-center items-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-neutral-900 border border-neutral-800 text-neutral-300 text-xs font-medium mb-6">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          Live on Soroban Testnet
        </div>

        <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-white mb-6 max-w-2xl">
          Confidential Disbursements on Stellar
        </h1>

        <p className="text-neutral-400 text-base sm:text-lg max-w-xl mb-10 leading-relaxed">
          Shield individual recipient amounts and donor linkages with zero-knowledge
          proofs over BN254, verified natively on Soroban smart contracts.
        </p>

        <div className="flex flex-wrap gap-4 justify-center items-center">
          <Link to="/claim">
            <Button className="bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold px-6 py-2.5 rounded-xl flex items-center gap-2 text-sm shadow-lg shadow-emerald-950/50 cursor-pointer">
              Launch Recipient Claim Portal
              <ArrowRight size={16} />
            </Button>
          </Link>
          <a
            href={`https://stellar.expert/explorer/testnet/contract/${TESTNET_CONFIG.contracts.vault}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-2.5 rounded-xl border border-neutral-800 text-neutral-300 hover:bg-neutral-900 text-sm font-medium transition-colors"
          >
            Explore Deployed Vault Contract
          </a>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-20 text-left w-full">
          <div className="p-5 rounded-2xl bg-neutral-900/50 border border-neutral-800/80 backdrop-blur-sm">
            <div className="w-10 h-10 rounded-xl bg-neutral-800 flex items-center justify-center text-emerald-400 mb-3">
              <LockKey size={20} weight="duotone" />
            </div>
            <h3 className="font-semibold text-white text-sm mb-1">
              Private Ownership
            </h3>
            <p className="text-xs text-neutral-400 leading-relaxed">
              Recipients prove knowledge of committed allocation secrets without revealing
              which commitment or amount is theirs.
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-neutral-900/50 border border-neutral-800/80 backdrop-blur-sm">
            <div className="w-10 h-10 rounded-xl bg-neutral-800 flex items-center justify-center text-emerald-400 mb-3">
              <Cpu size={20} weight="duotone" />
            </div>
            <h3 className="font-semibold text-white text-sm mb-1">
              Client-Side Proving
            </h3>
            <p className="text-xs text-neutral-400 leading-relaxed">
              Snarkjs generates Groth16 proofs directly in your browser or wallet,
              serialized into 256-byte Soroban pairing check formats.
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-neutral-900/50 border border-neutral-800/80 backdrop-blur-sm">
            <div className="w-10 h-10 rounded-xl bg-neutral-800 flex items-center justify-center text-emerald-400 mb-3">
              <Wallet size={20} weight="duotone" />
            </div>
            <h3 className="font-semibold text-white text-sm mb-1">
              Frontrunning Protected
            </h3>
            <p className="text-xs text-neutral-400 leading-relaxed">
              Architecture decision D4 cryptographically binds the payout recipient
              inside the SNARK constraints, preventing redirect attacks.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-900 py-6 text-center text-xs text-neutral-500">
        ShieldZK
      </footer>
    </div>
  )
}

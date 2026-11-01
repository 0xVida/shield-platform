import { useState } from "react"
import { useWallet } from "../context/wallet-context"
import { APP_NETWORK_PASSPHRASE, networkName } from "../lib/wallet"
import {
  Wallet,
  Check,
  Copy,
  SignOut,
  ArrowSquareOut,
  CircleNotch,
} from "@phosphor-icons/react"

interface WalletButtonProps {
  className?: string
  onAddressSelect?: (address: string) => void
}

export function WalletConnectButton({ className = "", onAddressSelect }: WalletButtonProps) {
  const {
    address,
    isConnected,
    isConnecting,
    hasFreighter,
    networkPassphrase,
    isWrongNetwork,
    connect,
    disconnect,
  } = useWallet()
  const [copied, setCopied] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  async function handleConnect() {
    const addr = await connect()
    if (addr && onAddressSelect) {
      onAddressSelect(addr)
    }
  }

  function handleCopy() {
    if (!address) return
    navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (hasFreighter === false) {
    return (
      <a
        href="https://www.freighter.app/"
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-neutral-900 border border-neutral-700/80 text-neutral-300 hover:text-white hover:border-neutral-600 transition-colors shadow-sm ${className}`}
        title="Freighter extension is required to connect your Stellar wallet"
      >
        <Wallet size={15} className="text-amber-400" />
        <span>Install Freighter</span>
        <ArrowSquareOut size={13} className="text-neutral-400" />
      </a>
    )
  }

  if (isConnected && address) {
    const displayAddr = `${address.slice(0, 4)}...${address.slice(-4)}`

    return (
      <div className={`relative inline-block ${className}`}>
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium bg-neutral-900/90 border border-emerald-500/40 text-neutral-200 hover:border-emerald-500/70 transition-colors shadow-sm cursor-pointer"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50 animate-pulse" />
          <span className="font-mono text-emerald-300">{displayAddr}</span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded border uppercase font-semibold ${
              isWrongNetwork
                ? "bg-amber-950 border-amber-800/60 text-amber-400"
                : "bg-emerald-950 border-emerald-800/60 text-emerald-400"
            }`}
            title={isWrongNetwork ? "Wrong network for this app" : undefined}
          >
            {networkName(networkPassphrase)}
          </span>
        </button>

        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute right-0 mt-2 w-64 p-3 bg-neutral-900 border border-neutral-800 rounded-xl shadow-2xl z-50 text-xs space-y-3 backdrop-blur-xl">
              <div>
                <span className="text-neutral-500 block text-[11px] mb-1">
                  Connected Stellar Account
                </span>
                <div className="font-mono text-neutral-200 text-[11px] break-all bg-neutral-950 p-2 rounded-lg border border-neutral-800/80">
                  {address}
                </div>
              </div>

              {isWrongNetwork && (
                <div className="p-2 rounded-lg bg-amber-950/40 border border-amber-900/50 text-amber-300 text-[11px]">
                  Freighter is on {networkName(networkPassphrase)}. Switch it to{" "}
                  {networkName(APP_NETWORK_PASSPHRASE)} in Freighter's settings to
                  sign transactions here.
                </div>
              )}

              <div className="flex items-center gap-2 pt-1 border-t border-neutral-800/80">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-medium transition-colors"
                >
                  {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                  <span>{copied ? "Copied" : "Copy Address"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    disconnect()
                    setMenuOpen(false)
                  }}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-950/40 border border-red-900/40 hover:bg-red-900/60 text-red-300 text-xs font-medium transition-colors"
                  title="Disconnect wallet"
                >
                  <SignOut size={13} />
                  <span>Disconnect</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={handleConnect}
      disabled={isConnecting}
      className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-neutral-950 transition-colors shadow-md shadow-emerald-950/40 disabled:opacity-50 cursor-pointer ${className}`}
    >
      {isConnecting ? (
        <>
          <CircleNotch size={14} className="animate-spin" />
          <span>Connecting...</span>
        </>
      ) : (
        <>
          <Wallet size={15} weight="duotone" />
          <span>Connect Freighter</span>
        </>
      )}
    </button>
  )
}

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useRef,
} from "react"
import freighterPkg from "@stellar/freighter-api"
import {
  APP_NETWORK_PASSPHRASE,
  freighterSigner,
  type SignTransaction,
  type WalletState,
} from "../lib/wallet"


const freighter: any = (freighterPkg as any)?.default || freighterPkg
const freighterIsConnected = freighter?.isConnected
const freighterRequestAccess = freighter?.requestAccess
const freighterGetAddress = freighter?.getAddress
const getNetworkDetails = freighter?.getNetworkDetails
const freighterSignTx = freighter?.signTransaction
const FreighterWatcher = freighter?.WatchWalletChanges

interface WalletContextType {
  address: string | null
  isConnected: boolean
  isConnecting: boolean
  hasFreighter: boolean | null
  network: string | null
  /** The network Freighter is on, or null if it couldn't be read. */
  networkPassphrase: string | null
  /** True when Freighter is on another network than the app's contracts. */
  isWrongNetwork: boolean
  error: string | null
  connect: () => Promise<string | null>
  disconnect: () => void
  /** Signs for submitTransaction. Refuses on the wrong network. */
  signTransaction: SignTransaction
  signTx: (xdr: string) => Promise<string>
}

const WalletContext = createContext<WalletContextType>({
  address: null,
  isConnected: false,
  isConnecting: false,
  hasFreighter: null,
  network: null,
  networkPassphrase: null,
  isWrongNetwork: false,
  error: null,
  connect: async () => null,
  disconnect: () => {},
  signTransaction: async () => ({ signedTxXdr: "" }),
  signTx: async () => "",
})

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [hasFreighter, setHasFreighter] = useState<boolean | null>(null)
  const [network, setNetwork] = useState<string | null>(null)
  const [networkPassphrase, setNetworkPassphrase] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The signer reads the wallet's state when it signs, so it's always current
  const state = useRef<WalletState>({ address, networkPassphrase })
  state.current = { address, networkPassphrase }
  const signTransaction = useMemo(
    () => freighterSigner(freighterSignTx, () => state.current),
    []
  )

  // Follow account and network switches made in Freighter after the page loaded
  useEffect(() => {
    if (!hasFreighter || !FreighterWatcher) return
    const watcher = new FreighterWatcher(3000)
    watcher.watch((info: { address: string; network: string; networkPassphrase: string; error?: unknown }) => {
      if (info.error) return
      setNetwork(info.network || null)
      setNetworkPassphrase(info.networkPassphrase || null)
      // Only follow the account while connected; never connect on the user's behalf
      setAddress((current) => {
        if (!current || !info.address || info.address === current) return current
        localStorage.setItem("shield_stellar_wallet", info.address)
        return info.address
      })
    })
    return () => watcher.stop()
  }, [hasFreighter])

  useEffect(() => {
    if (typeof window === "undefined") return

    let isMounted = true

    async function initWallet() {
      try {
        const connRes = await freighterIsConnected()
        if (!isMounted) return

        if (connRes && connRes.isConnected) {
          setHasFreighter(true)
          // Check if previously authorized
          const storedAddr = localStorage.getItem("shield_stellar_wallet")
          if (storedAddr) {
            const addrRes = await freighterGetAddress()
            if (addrRes && addrRes.address && !addrRes.error) {
              setAddress(addrRes.address)
            } else {
              localStorage.removeItem("shield_stellar_wallet")
            }
          }
          try {
            const net = await getNetworkDetails()
            if (net && net.network) setNetwork(net.network)
            if (net && net.networkPassphrase) setNetworkPassphrase(net.networkPassphrase)
          } catch {}
        } else {
          setHasFreighter(false)
        }
      } catch (err) {
        if (isMounted) setHasFreighter(false)
      }
    }

    initWallet()
    return () => {
      isMounted = false
    }
  }, [])

  async function connect(): Promise<string | null> {
    setError(null)
    setIsConnecting(true)
    try {
      const conn = await freighterIsConnected()
      if (!conn || !conn.isConnected) {
        setHasFreighter(false)
        setError("Freighter wallet extension not found. Please install Freighter from freighter.app.")
        setIsConnecting(false)
        return null
      }

      setHasFreighter(true)
      const accessRes = await freighterRequestAccess()
      if (accessRes.error) {
        throw new Error(
          typeof accessRes.error === "string"
            ? accessRes.error
            : accessRes.error?.message || "User rejected wallet connection"
        )
      }

      if (accessRes.address) {
        setAddress(accessRes.address)
        localStorage.setItem("shield_stellar_wallet", accessRes.address)
        try {
          const net = await getNetworkDetails()
          if (net && net.network) setNetwork(net.network)
          if (net && net.networkPassphrase) setNetworkPassphrase(net.networkPassphrase)
        } catch {}
        return accessRes.address
      }
      return null
    } catch (err: any) {
      console.error("Wallet connection error:", err)
      const msg = err?.message || "Failed to connect Stellar wallet"
      setError(msg)
      return null
    } finally {
      setIsConnecting(false)
    }
  }

  function disconnect() {
    setAddress(null)
    localStorage.removeItem("shield_stellar_wallet")
  }

  async function signTx(xdr: string): Promise<string> {
    return (await signTransaction(xdr)).signedTxXdr
  }

  return (
    <WalletContext.Provider
      value={{
        address,
        isConnected: !!address,
        isConnecting,
        hasFreighter,
        network,
        networkPassphrase,
        isWrongNetwork:
          !!networkPassphrase && networkPassphrase !== APP_NETWORK_PASSPHRASE,
        error,
        connect,
        disconnect,
        signTransaction,
        signTx,
      }}
    >
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  return useContext(WalletContext)
}

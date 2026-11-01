import { TESTNET_CONFIG } from "@workspace/sdk"
import type { SubmitOptions } from "@workspace/sdk/chain"

/** Signs a transaction, in the shape submitTransaction takes. */
export type SignTransaction = SubmitOptions["signTransaction"]

/** The network this app's contracts are deployed on. */
export const APP_NETWORK_PASSPHRASE = TESTNET_CONFIG.networkPassphrase

const NETWORK_NAMES: Record<string, string> = {
  "Test SDF Network ; September 2015": "Testnet",
  "Public Global Stellar Network ; September 2015": "Mainnet",
  "Test SDF Future Network ; October 2022": "Futurenet",
  "Standalone Network ; February 2017": "Local network",
}

/** A short name for a network passphrase, e.g. "Testnet". */
export function networkName(passphrase: string | null): string {
  if (!passphrase) return "Unknown network"
  return NETWORK_NAMES[passphrase] ?? "Custom network"
}

/** Freighter's signTransaction, as far as this app uses it. */
export type FreighterSign = (
  xdr: string,
  opts: { networkPassphrase: string; address?: string }
) => Promise<
  | string
  | {
      signedTxXdr?: string
      signerAddress?: string
      error?: string | { message?: string }
    }
>

/** What the signer needs to know about the wallet when it's asked to sign. */
export interface WalletState {
  address: string | null
  /** The network Freighter is on, or null if it couldn't be read. */
  networkPassphrase: string | null
}

/**
 * Wraps Freighter's signTransaction as a SignTransaction. Refuses before opening
 * Freighter when the wallet is on another network than the app: the network would
 * reject the transaction anyway, after the user had already approved it.
 */
export function freighterSigner(
  sign: FreighterSign,
  wallet: () => WalletState
): SignTransaction {
  return async (xdr) => {
    const { address, networkPassphrase } = wallet()
    if (networkPassphrase && networkPassphrase !== APP_NETWORK_PASSPHRASE) {
      throw new Error(
        `Freighter is on ${networkName(networkPassphrase)}. Switch it to ${networkName(APP_NETWORK_PASSPHRASE)} to sign.`
      )
    }
    const res = await sign(xdr, {
      networkPassphrase: APP_NETWORK_PASSPHRASE,
      address: address ?? undefined,
    })
    if (typeof res === "string") return { signedTxXdr: res }
    if (res.error) {
      throw new Error(
        typeof res.error === "string"
          ? res.error
          : res.error.message || "Signing failed"
      )
    }
    if (!res.signedTxXdr) {
      throw new Error("Freighter didn't return a signed transaction")
    }
    return {
      signedTxXdr: res.signedTxXdr,
      signerAddress: res.signerAddress ?? address ?? undefined,
    }
  }
}

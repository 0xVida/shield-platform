const STELLAR_EXPERT = "https://stellar.expert/explorer"

/** The networks Stellar Expert shows, by passphrase. A local network has none. */
const EXPLORER_NETWORKS: Record<string, string> = {
  "Test SDF Network ; September 2015": "testnet",
  "Public Global Stellar Network ; September 2015": "public",
  "Test SDF Future Network ; October 2022": "futurenet",
}

/**
 * A Stellar Expert link to a transaction, contract or account on the network with
 * this passphrase, or undefined for a network the explorer doesn't show (e.g. a
 * local one), so the page can leave the link out.
 */
export function explorerUrl(
  networkPassphrase: string,
  kind: "tx" | "contract" | "account",
  id: string
): string | undefined {
  const network = EXPLORER_NETWORKS[networkPassphrase]
  return network && `${STELLAR_EXPERT}/${network}/${kind}/${id}`
}

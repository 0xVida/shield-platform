import { describe, expect, test } from "bun:test"

import { explorerUrl } from "./explorer"

const HASH = "f66ae8f934cd197956838bb403ce4d04b69302cd2df7203aeff102c802348006"

describe("explorerUrl", () => {
  test("links to Stellar Expert on the transaction's network", () => {
    expect(explorerUrl("Test SDF Network ; September 2015", "tx", HASH)).toBe(
      `https://stellar.expert/explorer/testnet/tx/${HASH}`
    )
    expect(
      explorerUrl(
        "Public Global Stellar Network ; September 2015",
        "contract",
        "CABC"
      )
    ).toBe("https://stellar.expert/explorer/public/contract/CABC")
    expect(
      explorerUrl("Test SDF Future Network ; October 2022", "account", "GABC")
    ).toBe("https://stellar.expert/explorer/futurenet/account/GABC")
  })

  test("gives no link for a network the explorer doesn't show", () => {
    expect(
      explorerUrl("Standalone Network ; February 2017", "tx", HASH)
    ).toBeUndefined()
    expect(explorerUrl("my private network", "tx", HASH)).toBeUndefined()
  })
})

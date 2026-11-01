import { describe, expect, test } from "bun:test"

import {
  APP_NETWORK_PASSPHRASE,
  freighterSigner,
  networkName,
  type FreighterSign,
  type WalletState,
} from "./wallet"

const MAINNET = "Public Global Stellar Network ; September 2015"
const ADDRESS = "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR"

/** A fake Freighter that records what it was asked to sign. */
function fakeFreighter(answer: Awaited<ReturnType<FreighterSign>>) {
  const calls: Parameters<FreighterSign>[] = []
  const sign: FreighterSign = async (...args) => {
    calls.push(args)
    return answer
  }
  return { sign, calls }
}

const onTestnet: WalletState = {
  address: ADDRESS,
  networkPassphrase: APP_NETWORK_PASSPHRASE,
}

describe("networkName", () => {
  test("names the well-known networks", () => {
    expect(networkName(APP_NETWORK_PASSPHRASE)).toBe("Testnet")
    expect(networkName(MAINNET)).toBe("Mainnet")
    expect(networkName("some other passphrase")).toBe("Custom network")
    expect(networkName(null)).toBe("Unknown network")
  })
})

describe("freighterSigner", () => {
  test("signs for the app's network and the connected address", async () => {
    const freighter = fakeFreighter({
      signedTxXdr: "SIGNED",
      signerAddress: ADDRESS,
    })
    const signed = await freighterSigner(freighter.sign, () => onTestnet)("XDR")

    expect(signed).toEqual({ signedTxXdr: "SIGNED", signerAddress: ADDRESS })
    expect(freighter.calls).toEqual([
      ["XDR", { networkPassphrase: APP_NETWORK_PASSPHRASE, address: ADDRESS }],
    ])
  })

  test("refuses on another network without opening Freighter", async () => {
    const freighter = fakeFreighter({ signedTxXdr: "SIGNED" })
    const sign = freighterSigner(freighter.sign, () => ({
      ...onTestnet,
      networkPassphrase: MAINNET,
    }))

    await expect(sign("XDR")).rejects.toThrow(
      "Freighter is on Mainnet. Switch it to Testnet to sign."
    )
    expect(freighter.calls).toHaveLength(0)
  })

  test("reads the wallet's state when signing, not when created", async () => {
    let state = onTestnet
    const freighter = fakeFreighter({ signedTxXdr: "SIGNED" })
    const sign = freighterSigner(freighter.sign, () => state)

    state = { ...onTestnet, networkPassphrase: MAINNET }
    await expect(sign("XDR")).rejects.toThrow("Mainnet")
  })

  test("still tries when the network couldn't be read", async () => {
    const freighter = fakeFreighter({ signedTxXdr: "SIGNED" })
    await freighterSigner(freighter.sign, () => ({
      ...onTestnet,
      networkPassphrase: null,
    }))("XDR")
    expect(freighter.calls).toHaveLength(1)
  })

  test("passes Freighter's errors on, e.g. when the user declines", async () => {
    const declined = fakeFreighter({
      error: { message: "User declined access" },
    })
    await expect(
      freighterSigner(declined.sign, () => onTestnet)("XDR")
    ).rejects.toThrow("User declined access")

    const empty = fakeFreighter({})
    await expect(
      freighterSigner(empty.sign, () => onTestnet)("XDR")
    ).rejects.toThrow("didn't return a signed transaction")
  })

  test("accepts older Freighter versions that return the XDR as a string", async () => {
    const legacy = fakeFreighter("SIGNED")
    expect(await freighterSigner(legacy.sign, () => onTestnet)("XDR")).toEqual({
      signedTxXdr: "SIGNED",
    })
  })
})

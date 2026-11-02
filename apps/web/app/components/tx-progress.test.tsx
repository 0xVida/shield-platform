import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { TxProgress, stageLabel } from "./tx-progress"

/** Each step's label and state, as rendered. */
function steps(html: string): [string, string][] {
  return [
    ...html.matchAll(/data-state="(\w+)"[^>]*>.*?<\/svg>([^<]+)<\/li>/g),
  ].map((m) => [m[2]!, m[1]!])
}

describe("TxProgress", () => {
  test("marks earlier steps done, the current one in progress, later ones upcoming", () => {
    const html = renderToStaticMarkup(<TxProgress stage="submitting" />)
    expect(steps(html)).toEqual([
      ["Confirm in your wallet", "done"],
      ["Sending to the network", "current"],
      ["Waiting for confirmation", "upcoming"],
      ["Confirmed", "upcoming"],
    ])
  })

  test("marks every step done once confirmed", () => {
    const html = renderToStaticMarkup(<TxProgress stage="done" />)
    expect(steps(html).every(([, state]) => state === "done")).toBe(true)
  })

  test("marks the step where it stopped as failed", () => {
    const html = renderToStaticMarkup(<TxProgress stage="confirming" failed />)
    expect(steps(html).map(([, state]) => state)).toEqual([
      "done",
      "done",
      "failed",
      "upcoming",
    ])
  })

  test("links to the transaction only when there's a link", () => {
    const href = "https://stellar.expert/explorer/testnet/tx/abc"
    expect(
      renderToStaticMarkup(
        <TxProgress stage="confirming" explorerHref={href} />
      )
    ).toContain(`href="${href}"`)
    expect(
      renderToStaticMarkup(<TxProgress stage="confirming" />)
    ).not.toContain("<a")
  })
})

describe("stageLabel", () => {
  test("words each stage for people", () => {
    expect(stageLabel("signing")).toBe("Confirm in your wallet")
    expect(stageLabel("confirming")).toBe("Waiting for confirmation")
  })
})

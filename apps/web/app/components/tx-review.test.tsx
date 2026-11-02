import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { TxReview } from "./tx-review"

const lines = [
  { label: "Action", value: "Fund batch 42" },
  {
    label: "Paid from",
    value: "GBGT…BKZ2",
    full: "GBGTYDVZL6Z4EL4ZTLY3LIYTBZQWMIL3FHJY5PJV4E6EFJ45HY4VBKZ2",
  },
]

function render(busy = false) {
  return renderToStaticMarkup(
    <TxReview
      title="Review the deposit"
      lines={lines}
      confirmLabel="Sign & fund"
      onConfirm={() => {}}
      onCancel={() => {}}
      busy={busy}
    />
  )
}

describe("TxReview", () => {
  test("shows every line, with the full address on hover", () => {
    const html = render()
    expect(html).toContain("Review the deposit")
    expect(html).toContain("<dt")
    expect(html).toContain("Fund batch 42")
    expect(html).toContain(`title="${lines[1]!.full}"`)
    expect(html).toContain("Sign &amp; fund")
  })

  test("disables both buttons while busy", () => {
    // The real attribute, not the button library's data-disabled
    const disabled = (html: string) => html.match(/ disabled=""/g) ?? []
    expect(disabled(render())).toHaveLength(0)
    expect(disabled(render(true))).toHaveLength(2)
  })
})

import { useEffect, useState } from "react"
import { Link, useFetcher, useRevalidator } from "react-router"
import {
  ArrowLeft,
  ArrowSquareOut,
  ArrowsClockwise,
  Check,
  CheckCircle,
  Copy,
  Cpu,
  Coins,
  ListChecks,
  Stack,
} from "@phosphor-icons/react"
import { Button } from "@workspace/ui/components/button"

import type { Route } from "./+types/batch"
import { BatchStatusPill } from "../components/batch-status"
import { AppHeader } from "../components/app-header"
import { ErrorBox } from "../components/error-box"
import { StepIndicator } from "../components/step-indicator"
import { useWallet } from "../context/wallet-context"
import { WalletConnectButton } from "../components/wallet-button"
import type { VaultTransaction } from "@workspace/sdk/chain"
import { TxProgress, stageLabel, type TxStage } from "../components/tx-progress"
import { TxReview } from "../components/tx-review"
import { formatAmount } from "../lib/amount"
import {
  ApiError,
  api,
  type Batch,
  type BatchClaimExport,
  type TransactionStatus,
  type VaultConnection,
} from "../lib/api"
import { explorerUrl } from "../lib/explorer"
import { buildFunding, sendFunding } from "../lib/funding"
import { fundingReview, maxFee, type ReviewLine } from "../lib/tx-review"
import { APP_NETWORK_PASSPHRASE } from "../lib/wallet"

export function meta() {
  return [{ title: "Batch · ShieldZK" }]
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  try {
    const [batch, config] = await Promise.all([
      api.getBatch(params.batchId),
      api.config(),
    ])
    return { batch, vault: config.vault, error: null }
  } catch (err) {
    const error = err instanceof Error ? err.message : "Couldn't reach the API"
    return { batch: null, vault: null, error }
  }
}

type Funding = { funder: string; token: string; txHash: string }
type ActionBody = { intent: "prove" } | ({ intent: "funding" } & Funding)

export async function clientAction({ params, request }: Route.ClientActionArgs) {
  const body = (await request.json()) as ActionBody
  try {
    if (body.intent === "prove") {
      await api.prove(params.batchId)
    } else {
      const { funder, token, txHash } = body
      await api.reportFunding(params.batchId, { funder, token, txHash })
    }
    return { error: null }
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message }
    throw err
  }
}

/** A link to a transaction on the vault's network, if the explorer shows that network. */
function txHref(vault: VaultConnection | null, hash: string): string | undefined {
  return explorerUrl(vault?.networkPassphrase ?? APP_NETWORK_PASSPHRASE, "tx", hash)
}

const STEPS = [
  { title: "Created", icon: Stack },
  { title: "Conservation Proof", icon: Cpu },
  { title: "Fund Vault", icon: Coins },
  { title: "Claims", icon: ListChecks },
]

const primary =
  "bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold px-5 flex items-center gap-2 cursor-pointer disabled:opacity-50"

export function HydrateFallback() {
  return (
    <Shell>
      <p className="text-xs text-neutral-400">Loading batch...</p>
    </Shell>
  )
}

export default function BatchPage({ loaderData }: Route.ComponentProps) {
  const { batch, vault, error } = loaderData
  const { revalidate } = useRevalidator()

  // Proving runs in the background on the API: look again every few seconds
  const proving = batch?.status === "proving"
  useEffect(() => {
    if (!proving) return
    const timer = setInterval(revalidate, 3000)
    return () => clearInterval(timer)
  }, [proving, revalidate])

  if (!batch) {
    return (
      <Shell>
        <ErrorBox className="mb-6" title="Couldn't load this batch">{error}</ErrorBox>
      </Shell>
    )
  }

  const step =
    batch.status === "funded" ? 4 : batch.status === "proved" ? 3 : 2

  return (
    <Shell>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-3">
            {batch.name ?? `Batch ${batch.batchId}`}
            <BatchStatusPill status={batch.status} />
          </h1>
          <p className="text-[11px] text-neutral-500 font-mono mt-1">
            Batch #{batch.batchId} · created {new Date(batch.createdAt).toLocaleString()}
          </p>
        </div>
      </div>

      <StepIndicator steps={STEPS} current={step} />

      <div className="space-y-6">
        <Summary batch={batch} />
        <div className="bg-white dark:bg-neutral-900/80 border border-neutral-200 dark:border-neutral-800/80 rounded-2xl p-6 sm:p-8 shadow-xs">
          <div>
            {(batch.status === "created" || batch.status === "failed") && (
              <ProveStep batch={batch} />
            )}
            {batch.status === "proving" && <ProvingStep />}
            {batch.status === "proved" && <FundStep batch={batch} vault={vault} />}
            {batch.status === "funded" && <FundedStep batch={batch} vault={vault} />}
          </div>
        </div>
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 antialiased selection:bg-emerald-500/30 selection:text-emerald-300 transition-colors">
      <AppHeader />
      <main className="max-w-3xl mx-auto px-4 py-12">
        <Link
          to="/batches"
          className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white transition-colors mb-6"
        >
          <ArrowLeft size={14} />
          Batches
        </Link>
        {children}
      </main>
    </div>
  )
}

function StepTitle({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pb-4 mb-6 border-b border-neutral-800">
      <h2 className="text-base font-semibold text-white">{title}</h2>
      <p className="text-xs text-neutral-400">{children}</p>
    </div>
  )
}

/** What the public sees of the batch: its total, size and Merkle root. */
function Summary({ batch }: { batch: Batch }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
      <div className="p-3 bg-white dark:bg-neutral-900/60 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-2xs">
        <span className="text-neutral-500 dark:text-neutral-400 block text-[11px]">Total (public)</span>
        <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
          {formatAmount(BigInt(batch.total))} tokens
        </span>
      </div>
      <div className="p-3 bg-white dark:bg-neutral-900/60 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-2xs">
        <span className="text-neutral-500 dark:text-neutral-400 block text-[11px]">Recipients</span>
        <span className="font-mono font-medium text-neutral-900 dark:text-white">{batch.recipientCount}</span>
      </div>
      <div className="p-3 bg-white dark:bg-neutral-900/60 rounded-xl border border-neutral-200 dark:border-neutral-800 col-span-2 sm:col-span-1 shadow-2xs">
        <span className="text-neutral-500 dark:text-neutral-400 block text-[11px]">Merkle Root</span>
        <span className="font-mono font-medium text-neutral-900 dark:text-white truncate block" title={batch.root}>
          {batch.root.slice(0, 10)}...{batch.root.slice(-6)}
        </span>
      </div>
    </div>
  )
}

/** Step 2: prove the batch, or prove it again after a failure. */
function ProveStep({ batch }: { batch: Batch }) {
  const fetcher = useFetcher<typeof clientAction>()
  const submitting = fetcher.state !== "idle"
  return (
    <div>
      <StepTitle title="2. Conservation Proof">
        A Groth16 proof that the hidden amounts add up to the total, each within range.
        The vault only accepts the deposit with this proof.
      </StepTitle>
      {batch.status === "failed" && (
        <ErrorBox className="mb-6" title="The last attempt failed">{batch.error}</ErrorBox>
      )}
      {fetcher.data?.error && <ErrorBox className="mb-6" title="Couldn't start proving">{fetcher.data.error}</ErrorBox>}
      <div className="flex justify-end">
        <Button
          disabled={submitting}
          className={primary}
          onClick={() =>
            fetcher.submit({ intent: "prove" }, { method: "post", encType: "application/json" })
          }
        >
          {submitting ? (
            <ArrowsClockwise size={16} className="animate-spin" />
          ) : (
            <Cpu size={16} />
          )}
          {batch.status === "failed" ? "Try Again" : "Generate Conservation Proof"}
        </Button>
      </div>
    </div>
  )
}

function ProvingStep() {
  return (
    <div>
      <StepTitle title="2. Conservation Proof">
        Proving runs on the server, over the batch's 1024-leaf tree.
      </StepTitle>
      <div className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-900/40 text-emerald-400 text-xs flex items-center gap-2 animate-pulse">
        <Cpu size={15} />
        <span>Generating the Groth16 proof. This takes a minute or two; the page updates by itself.</span>
      </div>
    </div>
  )
}

// A funding the wallet sent but the API hasn't confirmed yet, kept across reloads
// so the page offers to confirm it rather than to pay again.
const fundingKey = (batchId: string) => `shieldzk:funding:${batchId}`

function savedFunding(batchId: string): Funding | undefined {
  try {
    const saved = localStorage.getItem(fundingKey(batchId))
    return saved ? JSON.parse(saved) : undefined
  } catch {
    return undefined
  }
}

function saveFunding(batchId: string, funding: Funding | undefined) {
  try {
    if (funding) localStorage.setItem(fundingKey(batchId), JSON.stringify(funding))
    else localStorage.removeItem(fundingKey(batchId))
  } catch {
    // Storage unavailable: the confirmation just won't survive a reload
  }
}

/** Step 3: the disburser's wallet deposits the total into the vault. */
function FundStep({ batch, vault }: { batch: Batch; vault: VaultConnection | null }) {
  const fetcher = useFetcher<typeof clientAction>()
  const { address: funder, signTransaction } = useWallet()
  const [token, setToken] = useState<string>(import.meta.env.VITE_TOKEN_CONTRACT_ID ?? "")
  const [sent, setSent] = useState<Funding>()
  // The built deposit, shown for review before the wallet signs it
  const [review, setReview] = useState<{ tx: VaultTransaction; lines: ReviewLine[] }>()
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<TxStage>()
  const [failed, setFailed] = useState(false)
  const [sendingHash, setSendingHash] = useState<string>()
  const [onChain, setOnChain] = useState<TransactionStatus>()
  const [error, setError] = useState<string>()
  const total = formatAmount(BigInt(batch.total))

  useEffect(() => setSent(savedFunding(batch.batchId)), [batch.batchId])

  // Once sent, show what the chain says about it: useful after a reload
  useEffect(() => {
    if (!sent) return
    api
      .tx(sent.txHash)
      .then(setOnChain)
      .catch(() => setOnChain(undefined))
  }, [sent?.txHash])

  if (!vault) {
    return (
      <div>
        <StepTitle title="3. Fund the Vault">Deposit the batch total.</StepTitle>
        <ErrorBox className="mb-6" title="Funding isn't set up">
          The API has no vault configured (STELLAR_RPC_URL, STELLAR_NETWORK_PASSPHRASE,
          VAULT_CONTRACT_ID).
        </ErrorBox>
      </div>
    )
  }

  /** Builds and simulates the deposit, then shows what the wallet will sign. */
  async function prepare() {
    if (!funder || !vault) return
    setBusy(true)
    setError(undefined)
    setStage(undefined)
    setFailed(false)
    try {
      const tx = await buildFunding({ vault, batch, funder, token: token.trim() })
      setReview({
        tx,
        lines: fundingReview({
          batchId: batch.batchId,
          total: BigInt(batch.total),
          token: token.trim(),
          funder,
          vault: vault.contractId,
          networkPassphrase: vault.networkPassphrase,
          fee: maxFee(tx),
        }),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  /** Signs and sends the reviewed deposit, then asks the API to confirm it. */
  async function fund() {
    if (!review || !funder) return
    setBusy(true)
    setError(undefined)
    setFailed(false)
    try {
      const txHash = await sendFunding(review.tx, {
        signTransaction,
        onStage: (next, hash) => {
          setStage(next)
          if (hash) setSendingHash(hash)
        },
      })
      setStage("done")
      const sentFunding = { funder, token: token.trim(), txHash }
      saveFunding(batch.batchId, sentFunding)
      setSent(sentFunding)
      confirm(sentFunding)
    } catch (err) {
      setFailed(true)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      // A failed send may have signed it; build it afresh next time
      setReview(undefined)
    }
  }

  function confirm(f: Funding) {
    fetcher.submit({ intent: "funding", ...f }, { method: "post", encType: "application/json" })
  }

  if (sent) {
    // Paid already: only the confirmation is left, never a second payment
    return (
      <div>
        <StepTitle title="3. Fund the Vault">
          The deposit was sent. Confirm it so the batch is marked as funded.
        </StepTitle>
        <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 text-xs space-y-2 mb-4">
          <div className="text-neutral-400">Transaction:</div>
          <a
            href={txHref(vault, sent.txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-emerald-400 break-all hover:text-emerald-300"
          >
            {sent.txHash}
          </a>
          {onChain && (
            <div className="text-[11px] text-neutral-400 pt-1">
              {onChain.status === "confirmed"
                ? `Confirmed on-chain in ledger ${onChain.ledger}.`
                : onChain.status === "failed"
                  ? "This transaction failed on-chain: nothing was deposited."
                  : "Not on-chain yet: it may still be pending."}
            </div>
          )}
        </div>
        {fetcher.data?.error && <ErrorBox className="mb-6" title="Not confirmed yet">{fetcher.data.error}</ErrorBox>}
        <div className="flex justify-end">
          <Button disabled={fetcher.state !== "idle"} className={primary} onClick={() => confirm(sent)}>
            {fetcher.state !== "idle" ? (
              <ArrowsClockwise size={16} className="animate-spin" />
            ) : (
              <CheckCircle size={16} />
            )}
            Confirm Funding
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <StepTitle title="3. Fund the Vault">
        Your wallet deposits {total} tokens into the ShieldVault, which verifies the
        conservation proof before it accepts them.
      </StepTitle>

      <div>
        <label htmlFor="token" className="block text-xs font-medium text-neutral-300 mb-1.5">
          Token Contract (Stellar Asset Contract)
        </label>
        <input
          id="token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 transition-colors font-mono"
          placeholder="C..."
        />
      </div>

      <div className="flex items-center justify-between p-3.5 rounded-xl bg-neutral-950/80 border border-neutral-800">
        <div>
          <div className="text-xs font-medium text-white">Funding Wallet (Freighter)</div>
          <div className="text-[11px] text-neutral-400 font-mono">
            {funder ? `${funder.slice(0, 6)}...${funder.slice(-4)}` : "Connect the wallet that pays the total"}
          </div>
        </div>
        {!funder && <WalletConnectButton />}
      </div>

      {stage && (
        <TxProgress
          stage={stage}
          failed={failed}
          explorerHref={sendingHash && txHref(vault, sendingHash)}
        />
      )}

      {error && <ErrorBox className="mb-6" title="Not funded">{error}</ErrorBox>}

      {review && !busy ? (
        <TxReview
          title="Review the deposit"
          lines={review.lines}
          confirmLabel={`Sign & Fund ${total} Tokens`}
          onConfirm={fund}
          onCancel={() => setReview(undefined)}
        />
      ) : (
        <div className="flex justify-end">
          <Button disabled={!funder || !token.trim() || busy} onClick={prepare} className={primary}>
            {busy ? (
              <>
                <ArrowsClockwise size={16} className="animate-spin" />
                {stage ? stageLabel(stage) : "Preparing the deposit..."}
              </>
            ) : (
              <>
                <Coins size={16} />
                Fund {total} Tokens
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}

/** Step 4: a funded batch, and how much of it has been claimed. */
function FundedStep({ batch, vault }: { batch: Batch; vault: VaultConnection | null }) {
  const { revalidate, state } = useRevalidator()
  const total = BigInt(batch.total)
  const withdrawn = batch.claims ? BigInt(batch.claims.withdrawn) : undefined
  const percent = withdrawn !== undefined && total > 0n ? Number((withdrawn * 100n) / total) : 0

  const [claimsList, setClaimsList] = useState<BatchClaimExport[]>([])
  const [loadingClaims, setLoadingClaims] = useState(false)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

  useEffect(() => {
    saveFunding(batch.batchId, undefined)
    setLoadingClaims(true)
    api
      .getBatchClaims(batch.batchId)
      .then((res) => setClaimsList(res.claims || []))
      .catch((err) => console.warn("Could not load batch claims:", err))
      .finally(() => setLoadingClaims(false))
  }, [batch.batchId])

  function copyClaimLink(url: string, index: number) {
    const fullUrl = `${window.location.origin}${url}`
    navigator.clipboard.writeText(fullUrl)
    setCopiedIndex(index)
    setTimeout(() => setCopiedIndex(null), 2000)
  }

  return (
    <div className="space-y-6">
      <StepTitle title="4. Claims">
        The vault holds the batch. Recipients claim their allocations privately.
      </StepTitle>

      {withdrawn === undefined ? (
        <p className="text-xs text-neutral-400">Claim progress isn't available right now.</p>
      ) : (
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-neutral-400">Claimed</span>
            <span className="font-mono text-white">
              {formatAmount(withdrawn)} of {formatAmount(total)} tokens
            </span>
          </div>
          <div className="h-2 rounded-full bg-neutral-800 overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}

      <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 text-[11px] font-mono space-y-1.5">
        <div className="text-neutral-500">
          Token: <span className="text-neutral-300 break-all">{batch.token}</span>
        </div>
        <div className="text-neutral-500">
          Funder: <span className="text-neutral-300 break-all">{batch.funder}</span>
        </div>
        <div className="text-neutral-500">
          Funded: <span className="text-neutral-300">{batch.fundedAt && new Date(batch.fundedAt).toLocaleString()}</span>
        </div>
      </div>

      {/* Recipient Onboarding & Claim Distribution */}
      <div className="pt-4 border-t border-neutral-800/80 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold text-neutral-200">SDP Recipient Delivery Links</h3>
            <p className="text-[11px] text-neutral-400">
              Share individual claim links with recipients to enable confidential proof generation and payout.
            </p>
          </div>
          <span className="text-[11px] font-mono text-neutral-500">
            {claimsList.length} recipient{claimsList.length === 1 ? "" : "s"}
          </span>
        </div>

        {loadingClaims ? (
          <div className="text-xs text-neutral-500 flex items-center gap-2 py-3">
            <ArrowsClockwise size={14} className="animate-spin" />
            Loading claim delivery links...
          </div>
        ) : claimsList.length === 0 ? (
          <p className="text-xs text-neutral-500 py-2">No individual recipient links available for this batch.</p>
        ) : (
          <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden divide-y divide-neutral-200 dark:divide-neutral-800/60 bg-white dark:bg-neutral-950/60 max-h-60 overflow-y-auto shadow-2xs">
            {claimsList.map((item, idx) => (
              <div key={idx} className="p-3 flex items-center justify-between gap-4 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-neutral-900 dark:text-neutral-200 truncate">{item.recipient}</span>
                    <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800/40 text-emerald-800 dark:text-emerald-400 px-1.5 py-0.5 rounded font-medium">
                      Confidential Link
                    </span>
                  </div>
                  <div className="text-[11px] text-neutral-500 font-mono mt-0.5 truncate">
                    Private single-use claim link
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyClaimLink(item.claimUrl, idx)}
                    className="h-7 text-xs border border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  >
                    {copiedIndex === idx ? (
                      <>
                        <Check size={12} className="text-emerald-600 dark:text-emerald-400" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy size={12} />
                        Copy Link
                      </>
                    )}
                  </Button>
                  <Link
                    to={item.claimUrl}
                    target="_blank"
                    className="h-7 px-2.5 text-xs bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-500/30 rounded-lg inline-flex items-center gap-1 font-medium transition-colors shadow-2xs"
                  >
                    Open
                    <ArrowSquareOut size={12} />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-between items-center pt-2">
        <Button
          variant="outline"
          disabled={state !== "idle"}
          onClick={() => void revalidate()}
          className="border-neutral-800 text-neutral-300 hover:bg-neutral-800 cursor-pointer"
        >
          Refresh
        </Button>
        {batch.fundingTx && txHref(vault, batch.fundingTx) && (
          <a
            href={txHref(vault, batch.fundingTx)}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold px-4 py-2 rounded-lg text-sm inline-flex items-center gap-1.5 transition-colors"
          >
            Funding Transaction
            <ArrowSquareOut size={14} />
          </a>
        )}
      </div>
    </div>
  )
}

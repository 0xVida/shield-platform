import { useEffect, useState } from "react"
import { Link, useFetcher, useRevalidator } from "react-router"
import {
  ArrowLeft,
  ArrowSquareOut,
  ArrowsClockwise,
  CheckCircle,
  Cpu,
  Coins,
  ListChecks,
  Stack,
  WarningCircle,
} from "@phosphor-icons/react"
import { Button } from "@workspace/ui/components/button"

import type { Route } from "./+types/batch"
import { BatchStatusPill } from "../components/batch-status"
import { DisburseHeader } from "../components/disburse-header"
import { useWallet } from "../context/wallet-context"
import { WalletConnectButton } from "../components/wallet-button"
import { formatAmount } from "../lib/amount"
import { ApiError, api, type Batch, type VaultConnection } from "../lib/api"
import { fundBatch } from "../lib/funding"

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

const EXPLORER = "https://stellar.expert/explorer/testnet"

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
        <ErrorBox title="Couldn't load this batch">{error}</ErrorBox>
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

      {/* Step Indicator */}
      <div className="grid grid-cols-4 gap-2 mb-8">
        {[
          { num: 1, title: "Created", icon: Stack },
          { num: 2, title: "Conservation Proof", icon: Cpu },
          { num: 3, title: "Fund Vault", icon: Coins },
          { num: 4, title: "Claims", icon: ListChecks },
        ].map((s) => {
          const Icon = s.icon
          const isActive = step === s.num
          const isCompleted = step > s.num
          return (
            <div
              key={s.num}
              className={`p-3 rounded-xl border text-center transition-all ${
                isCompleted
                  ? "bg-neutral-900/60 border-emerald-500/40 text-emerald-400"
                  : isActive
                    ? "bg-neutral-900 border-emerald-500 text-white shadow-lg shadow-emerald-950/40"
                    : "bg-neutral-900/20 border-neutral-800/60 text-neutral-500"
              }`}
            >
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Icon size={16} weight={isActive ? "duotone" : "regular"} />
                <span className="text-xs font-medium">Step {s.num}</span>
              </div>
              <div className="text-[11px] font-medium tracking-tight truncate">
                {s.title}
              </div>
            </div>
          )
        })}
      </div>

      <div className="space-y-6">
        <Summary batch={batch} />
        <div className="bg-neutral-900/80 border border-neutral-800/80 rounded-2xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-72 h-72 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
          <div className="relative">
            {(batch.status === "created" || batch.status === "failed") && (
              <ProveStep batch={batch} />
            )}
            {batch.status === "proving" && <ProvingStep />}
            {batch.status === "proved" && <FundStep batch={batch} vault={vault} />}
            {batch.status === "funded" && <FundedStep batch={batch} />}
          </div>
        </div>
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 antialiased selection:bg-emerald-500/30 selection:text-emerald-300">
      <DisburseHeader />
      <main className="max-w-3xl mx-auto px-4 py-12">
        <Link
          to="/batches"
          className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition-colors mb-6"
        >
          <ArrowLeft size={14} />
          Batches
        </Link>
        {children}
      </main>
    </div>
  )
}

function ErrorBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 p-4 rounded-xl bg-red-950/40 border border-red-800/60 text-red-300 text-xs flex items-start gap-3">
      <WarningCircle size={18} className="shrink-0 mt-0.5 text-red-400" />
      <div className="min-w-0 break-words">
        <span className="font-semibold block mb-0.5">{title}</span>
        {children}
      </div>
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
      <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800">
        <span className="text-neutral-500 block text-[11px]">Total (public)</span>
        <span className="font-mono font-semibold text-emerald-400">
          {formatAmount(BigInt(batch.total))} tokens
        </span>
      </div>
      <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800">
        <span className="text-neutral-500 block text-[11px]">Recipients</span>
        <span className="font-mono font-medium text-white">{batch.recipientCount}</span>
      </div>
      <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800 col-span-2 sm:col-span-1">
        <span className="text-neutral-500 block text-[11px]">Merkle Root</span>
        <span className="font-mono font-medium text-white truncate block" title={batch.root}>
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
        <ErrorBox title="The last attempt failed">{batch.error}</ErrorBox>
      )}
      {fetcher.data?.error && <ErrorBox title="Couldn't start proving">{fetcher.data.error}</ErrorBox>}
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
  const [funding, setFunding] = useState(false)
  const [error, setError] = useState<string>()
  const total = formatAmount(BigInt(batch.total))

  useEffect(() => setSent(savedFunding(batch.batchId)), [batch.batchId])

  if (!vault) {
    return (
      <div>
        <StepTitle title="3. Fund the Vault">Deposit the batch total.</StepTitle>
        <ErrorBox title="Funding isn't set up">
          The API has no vault configured (STELLAR_RPC_URL, STELLAR_NETWORK_PASSPHRASE,
          VAULT_CONTRACT_ID).
        </ErrorBox>
      </div>
    )
  }

  async function fund() {
    if (!funder || !vault) return
    setFunding(true)
    setError(undefined)
    try {
      const txHash = await fundBatch({
        vault,
        batch,
        funder,
        token: token.trim(),
        signTransaction,
      })
      const sentFunding = { funder, token: token.trim(), txHash }
      saveFunding(batch.batchId, sentFunding)
      setSent(sentFunding)
      confirm(sentFunding)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setFunding(false)
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
            href={`${EXPLORER}/tx/${sent.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-emerald-400 break-all hover:text-emerald-300"
          >
            {sent.txHash}
          </a>
        </div>
        {fetcher.data?.error && <ErrorBox title="Not confirmed yet">{fetcher.data.error}</ErrorBox>}
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

      {error && <ErrorBox title="Not funded">{error}</ErrorBox>}

      <div className="flex justify-end">
        <Button disabled={!funder || !token.trim() || funding} onClick={fund} className={primary}>
          {funding ? (
            <>
              <ArrowsClockwise size={16} className="animate-spin" />
              Waiting for your wallet...
            </>
          ) : (
            <>
              <Coins size={16} />
              Fund {total} Tokens
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

/** Step 4: a funded batch, and how much of it has been claimed. */
function FundedStep({ batch }: { batch: Batch }) {
  const { revalidate, state } = useRevalidator()
  const total = BigInt(batch.total)
  const withdrawn = batch.claims ? BigInt(batch.claims.withdrawn) : undefined
  const percent = withdrawn !== undefined && total > 0n ? Number((withdrawn * 100n) / total) : 0

  useEffect(() => saveFunding(batch.batchId, undefined), [batch.batchId])

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

      <div className="flex justify-between items-center">
        <Button
          variant="outline"
          disabled={state !== "idle"}
          onClick={() => void revalidate()}
          className="border-neutral-800 text-neutral-300 hover:bg-neutral-800 cursor-pointer"
        >
          Refresh
        </Button>
        {batch.fundingTx && (
          <a
            href={`${EXPLORER}/tx/${batch.fundingTx}`}
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

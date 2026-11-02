import { useState, useEffect } from "react"
import { useSearchParams } from "react-router"
import {
  LockKey,
  Wallet,
  Cpu,
  CheckCircle,
  ArrowRight,
  Check,
  ArrowsClockwise,
  Receipt,
  ArrowSquareOut,
} from "@phosphor-icons/react"
import { Button } from "@workspace/ui/components/button"
import { generateClaimProof, TESTNET_CONFIG, type ClaimProofOutput } from "@workspace/sdk"
import {
  ShieldVaultClient,
  submitTransaction,
  type VaultTransaction,
} from "@workspace/sdk/chain"
import { useWallet } from "../context/wallet-context"
import { AppHeader } from "../components/app-header"
import { ErrorBox } from "../components/error-box"
import { StepIndicator } from "../components/step-indicator"
import { WalletConnectButton } from "../components/wallet-button"
import { TxProgress, stageLabel, type TxStage } from "../components/tx-progress"
import { TxReview } from "../components/tx-review"
import { api, type PreparedClaim, type VaultConnection } from "../lib/api"
import { formatAmount } from "../lib/amount"
import { explorerUrl } from "../lib/explorer"
import { claimReview, maxFee, shortAddress, type ReviewLine } from "../lib/tx-review"

export function meta() {
  return [{ title: "Claim · ShieldZK" }]
}

// The testnet deployment, for when the API doesn't say which vault it uses
const FALLBACK_VAULT: VaultConnection = {
  contractId: TESTNET_CONFIG.contracts.vault,
  networkPassphrase: TESTNET_CONFIG.networkPassphrase,
  rpcUrl: TESTNET_CONFIG.rpcUrl,
  allowHttp: false,
}

const STEPS = [
  { title: "Allocation", icon: LockKey },
  { title: "Payout Address", icon: Wallet },
  { title: "Claim", icon: Cpu },
  { title: "Done", icon: CheckCircle },
]

const input =
  "w-full bg-white dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-white focus:outline-none focus:border-emerald-500 transition-colors font-mono"
const primary =
  "bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-5 flex items-center gap-2 cursor-pointer disabled:opacity-50 shadow-xs"
const secondary =
  "border border-neutral-300 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 bg-white dark:bg-neutral-900/40 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer shadow-2xs"

/** What a looked-up allocation allows: only a funded batch's unspent claim can be made. */
function claimState(claim: PreparedClaim): { label: string; canClaim: boolean } {
  if (claim.isSpent) return { label: "Already claimed", canClaim: false }
  if (claim.batchStatus !== "funded") return { label: "Batch not funded yet", canClaim: false }
  return { label: "Ready to claim", canClaim: claim.isEligible }
}

export default function ClaimPage() {
  const [searchParams] = useSearchParams()
  const { address: walletAddress, isConnected, signTransaction } = useWallet()

  // Finding the allocation
  const [lookupToken, setLookupToken] = useState(searchParams.get("token") ?? "")
  const [lookupBatch, setLookupBatch] = useState(searchParams.get("batch") ?? "")
  const [lookupRecipient, setLookupRecipient] = useState(searchParams.get("recipient") ?? "")
  const [useLegacyLookup, setUseLegacyLookup] = useState(!searchParams.get("token") && !!(searchParams.get("batch") || searchParams.get("recipient")))
  const [isLookingUp, setIsLookingUp] = useState(false)
  const [claim, setClaim] = useState<PreparedClaim | null>(null)

  // Where the payout goes: the connected wallet, unless typed in
  const [recipientInput, setRecipientInput] = useState<string>()
  const recipient = recipientInput ?? walletAddress ?? ""

  const [step, setStep] = useState(1)
  const [provingStage, setProvingStage] = useState<string | null>(null)
  const [proof, setProof] = useState<ClaimProofOutput | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Sending the claim
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStage, setSubmitStage] = useState<TxStage | null>(null)
  const [submitFailed, setSubmitFailed] = useState(false)
  // The built claim, shown for review before the wallet signs it
  const [review, setReview] = useState<{ tx: VaultTransaction; lines: ReviewLine[] } | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)

  // Claim on the vault the API funds batches on, so both sides use the same one
  const [vault, setVault] = useState<VaultConnection>(FALLBACK_VAULT)
  useEffect(() => {
    api
      .config()
      .then((config) => config.vault && setVault(config.vault))
      .catch(() => {})
  }, [])
  const txLink = (hash: string) => explorerUrl(vault.networkPassphrase, "tx", hash)

  // A claim link carries a token or batch+recipient: look the allocation up straight away
  useEffect(() => {
    const token = searchParams.get("token")
    const batch = searchParams.get("batch")
    const reference = searchParams.get("recipient")
    if (token) {
      void lookUp({ token })
    } else if (batch && reference) {
      void lookUp({ batchId: batch, recipient: reference })
    }
  }, [searchParams])

  async function lookUp(params: { token?: string; batchId?: string; recipient?: string }) {
    if (!params.token?.trim() && (!params.batchId?.trim() || !params.recipient?.trim())) return
    setError(null)
    setIsLookingUp(true)
    try {
      setClaim(await api.prepareClaim(params))
    } catch (err) {
      setClaim(null)
      setError(err instanceof Error ? err.message : "Couldn't find this allocation")
    } finally {
      setIsLookingUp(false)
    }
  }

  async function handleGenerateProof() {
    if (!claim) return
    setError(null)
    try {
      setProvingStage("Downloading the circuit files...")
      const [wasm, zkey] = await Promise.all(
        ["/zk/claim.wasm", "/zk/claim.zkey"].map(async (path) => {
          const res = await fetch(path)
          if (!res.ok) throw new Error(`Could not load ${path} (HTTP ${res.status})`)
          return new Uint8Array(await res.arrayBuffer())
        })
      )

      setProvingStage("Generating the proof in your browser. This can take a minute...")
      const out = await generateClaimProof(
        {
          root: claim.root,
          nullifierHash: claim.nullifierHash,
          recipientAddress: recipient,
          amount: claim.amount,
          secret: claim.secret,
          batchId: claim.batchId,
          pathElements: claim.pathElements,
          pathIndices: claim.pathIndices,
        },
        wasm!,
        zkey!
      )
      setProof(out)
      setStep(3)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate the proof")
    } finally {
      setProvingStage(null)
    }
  }

  /** Builds and simulates the claim, then shows what the wallet will sign. */
  async function handleReview() {
    if (!claim || !proof || !walletAddress) return
    // Batch ids are per funder, so a batch is (funder, batchId)
    const funder = claim.funder
    if (!funder) {
      setError("This claim doesn't say who funded the batch. Look the claim up again.")
      return
    }
    setError(null)
    setIsSubmitting(true)
    setSubmitStage(null)
    setSubmitFailed(false)
    try {
      const tx = await new ShieldVaultClient(vault).buildWithdraw({
        source: walletAddress,
        funder,
        batchId: BigInt(claim.batchId),
        amount: BigInt(claim.amount),
        recipient,
        nullifier: BigInt(claim.nullifierHash),
        proof: proof.proofBytes,
      })
      setReview({
        tx,
        lines: claimReview({
          batchId: claim.batchId,
          funder,
          amount: BigInt(claim.amount),
          recipient,
          submitter: walletAddress,
          vault: vault.contractId,
          networkPassphrase: vault.networkPassphrase,
          fee: maxFee(tx),
        }),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't prepare the claim")
    } finally {
      setIsSubmitting(false)
    }
  }

  /** Signs and sends the reviewed claim, showing its progress. */
  async function handleWithdraw() {
    if (!review) return
    setError(null)
    setIsSubmitting(true)
    setSubmitFailed(false)
    try {
      const { hash } = await submitTransaction(review.tx, {
        signTransaction,
        onStage: (stage, hash) => {
          setSubmitStage(stage)
          if (hash) setTxHash(hash)
        },
      })
      setTxHash(hash)
      setSubmitStage("done")
      setStep(4)
    } catch (err) {
      setSubmitFailed(true)
      setError(err instanceof Error ? err.message : "The claim failed on-chain")
    } finally {
      // A failed send may have signed it; build it afresh next time
      setReview(null)
      setIsSubmitting(false)
    }
  }

  function startOver() {
    setStep(1)
    setClaim(null)
    setProof(null)
    setTxHash(null)
    setSubmitStage(null)
    setError(null)
  }

  const state = claim && claimState(claim)

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 antialiased selection:bg-emerald-500/30 selection:text-emerald-300 transition-colors">
      <AppHeader />

      <main className="max-w-3xl mx-auto px-4 py-12">
        <div className="text-center mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-neutral-900 dark:text-white mb-2">
            Claim Your Allocation
          </h1>
          <p className="text-neutral-600 dark:text-neutral-400 text-sm max-w-lg mx-auto">
            Your browser proves you're owed this allocation without revealing which one
            it is. Only the amount and the payout address appear on-chain.
          </p>
        </div>

        <StepIndicator steps={STEPS} current={step} onSelect={step < 4 ? setStep : undefined} />

        <div className="bg-white dark:bg-neutral-900/80 border border-neutral-200 dark:border-neutral-800/80 rounded-2xl p-6 sm:p-8 shadow-xs">
          {error && (
            <ErrorBox title="Something went wrong" className="mb-6">
              {error}
            </ErrorBox>
          )}

          {/* STEP 1: FIND THE ALLOCATION */}
          {step === 1 && (
            <div className="space-y-6">
              <StepTitle title="1. Find your allocation">
                Use your confidential claim token or your disbursement invitation.
              </StepTitle>

              {!useLegacyLookup ? (
                <div className="space-y-3">
                  <Field label="Claim Token (from your confidential claim link)" htmlFor="token">
                    <input
                      id="token"
                      value={lookupToken}
                      onChange={(e) => setLookupToken(e.target.value)}
                      className={input}
                      placeholder="Paste your private bearer token (e.g. from /claim?token=...)"
                    />
                  </Field>
                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => setUseLegacyLookup(true)}
                      className="text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 underline cursor-pointer"
                    >
                      Or search by Batch ID and reference
                    </button>
                    <Button
                      variant="outline"
                      disabled={isLookingUp || !lookupToken.trim()}
                      onClick={() => lookUp({ token: lookupToken.trim() })}
                      className={secondary}
                    >
                      {isLookingUp ? (
                        <ArrowsClockwise size={14} className="animate-spin" />
                      ) : (
                        <Receipt size={14} />
                      )}
                      Find Allocation
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Batch ID" htmlFor="batch">
                      <input
                        id="batch"
                        value={lookupBatch}
                        onChange={(e) => setLookupBatch(e.target.value)}
                        className={input}
                        placeholder="e.g. 1793579695998"
                      />
                    </Field>
                    <Field label="Your reference (email, phone or SDP id)" htmlFor="reference">
                      <input
                        id="reference"
                        value={lookupRecipient}
                        onChange={(e) => setLookupRecipient(e.target.value)}
                        className={input}
                        placeholder="e.g. alice@example.com"
                      />
                    </Field>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => setUseLegacyLookup(false)}
                      className="text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 underline cursor-pointer"
                    >
                      Use single-use claim token instead
                    </button>
                    <Button
                      variant="outline"
                      disabled={isLookingUp || !lookupBatch.trim() || !lookupRecipient.trim()}
                      onClick={() => lookUp({ batchId: lookupBatch.trim(), recipient: lookupRecipient.trim() })}
                      className={secondary}
                    >
                      {isLookingUp ? (
                        <ArrowsClockwise size={14} className="animate-spin" />
                      ) : (
                        <Receipt size={14} />
                      )}
                      Find Allocation
                    </Button>
                  </div>
                </div>
              )}

              {claim && state && (
                <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-950/60 border border-neutral-200 dark:border-neutral-800 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs shadow-2xs">
                  <div>
                    <span className="text-neutral-500 dark:text-neutral-400 block text-[11px]">Your allocation</span>
                    <span className="text-base font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                      {formatAmount(BigInt(claim.amount))} tokens
                    </span>
                  </div>
                  <div>
                    <span className="text-neutral-500 dark:text-neutral-400 block text-[11px]">Batch</span>
                    <span className="font-mono text-neutral-800 dark:text-neutral-300">#{claim.batchId}</span>
                  </div>
                  <div>
                    <span className="text-neutral-500 dark:text-neutral-400 block text-[11px]">Status</span>
                    <span className={state.canClaim ? "text-emerald-600 dark:text-emerald-400 font-semibold" : "text-amber-600 dark:text-amber-300"}>
                      {state.label}
                    </span>
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <Button disabled={!state?.canClaim} onClick={() => setStep(2)} className={primary}>
                  Continue
                  <ArrowRight size={16} />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 2: PAYOUT ADDRESS AND PROOF */}
          {step === 2 && claim && (
            <div className="space-y-6">
              <StepTitle title="2. Choose where the payout goes">
                The proof is bound to this address, so nobody who sees it can redirect the
                payout.
              </StepTitle>

              {!isConnected && (
                <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-neutral-50 dark:bg-neutral-950/80 border border-neutral-200 dark:border-neutral-800 text-xs text-neutral-600 dark:text-neutral-400 shadow-2xs">
                  Connect Freighter to pay out to your wallet. You'll also need it to sign
                  the claim.
                  <WalletConnectButton />
                </div>
              )}

              <Field label="Payout address (G... or C...)" htmlFor="payout">
                <input
                  id="payout"
                  value={recipient}
                  onChange={(e) => setRecipientInput(e.target.value.trim())}
                  className={input}
                  placeholder="G..."
                />
                {isConnected && recipient === walletAddress && (
                  <span className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
                    <Check size={12} /> Your connected wallet
                  </span>
                )}
              </Field>

              {provingStage && (
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-400 text-xs flex items-center gap-2 animate-pulse">
                  <Cpu size={15} />
                  {provingStage}
                </div>
              )}

              <div className="flex justify-between items-center">
                <Button variant="outline" onClick={() => setStep(1)} className={secondary}>
                  Back
                </Button>
                <Button
                  disabled={!!provingStage || !recipient}
                  onClick={handleGenerateProof}
                  className={primary}
                >
                  {provingStage ? (
                    <ArrowsClockwise size={16} className="animate-spin" />
                  ) : (
                    <Cpu size={16} />
                  )}
                  Generate Proof
                </Button>
              </div>
            </div>
          )}

          {/* STEP 3: REVIEW AND SEND */}
          {step === 3 && claim && proof && (
            <div className="space-y-6">
              <StepTitle title="3. Claim">
                The proof is ready. Review the claim, then sign it with your wallet.
              </StepTitle>

              <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-950/60 border border-neutral-200 dark:border-neutral-800 grid grid-cols-2 gap-3 text-xs shadow-2xs">
                <div>
                  <span className="text-neutral-500 dark:text-neutral-400 block text-[11px]">Payout</span>
                  <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                    {formatAmount(BigInt(claim.amount))} tokens
                  </span>
                </div>
                <div>
                  <span className="text-neutral-500 dark:text-neutral-400 block text-[11px]">To</span>
                  <span className="font-mono text-neutral-800 dark:text-neutral-300" title={recipient}>
                    {shortAddress(recipient)}
                  </span>
                </div>
              </div>

              {submitStage && (
                <TxProgress
                  stage={submitStage}
                  failed={submitFailed}
                  explorerHref={txHash ? txLink(txHash) : undefined}
                />
              )}

              {review && !isSubmitting ? (
                <TxReview
                  title="Review your claim"
                  lines={review.lines}
                  confirmLabel="Sign with Freighter & Claim"
                  onConfirm={handleWithdraw}
                  onCancel={() => setReview(null)}
                />
              ) : (
                <div className="flex justify-between items-center">
                  <Button variant="outline" onClick={() => setStep(2)} className={secondary}>
                    Back
                  </Button>
                  {walletAddress ? (
                    <Button disabled={isSubmitting} onClick={handleReview} className={primary}>
                      {isSubmitting ? (
                        <>
                          <ArrowsClockwise size={16} className="animate-spin" />
                          {submitStage ? stageLabel(submitStage) : "Preparing your claim..."}
                        </>
                      ) : (
                        <>
                          <CheckCircle size={16} />
                          Review Claim
                        </>
                      )}
                    </Button>
                  ) : (
                    <WalletConnectButton />
                  )}
                </div>
              )}
            </div>
          )}

          {/* STEP 4: PAID */}
          {step === 4 && claim && (
            <div className="space-y-6 text-center py-6">
              <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 mx-auto">
                <CheckCircle size={36} weight="duotone" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-1">Claimed</h2>
                <p className="text-xs text-neutral-600 dark:text-neutral-400">
                  {formatAmount(BigInt(claim.amount))} tokens were paid to{" "}
                  <span className="font-mono" title={recipient}>
                    {shortAddress(recipient)}
                  </span>
                  .
                </p>
              </div>
              <div className="flex justify-center gap-3">
                <Button variant="outline" onClick={startOver} className={secondary}>
                  Claim Another
                </Button>
                {txHash && txLink(txHash) && (
                  <a
                    href={txLink(txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-4 py-2 rounded-lg text-sm inline-flex items-center gap-1.5 transition-colors shadow-xs"
                  >
                    View on Stellar Expert
                    <ArrowSquareOut size={14} />
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function StepTitle({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pb-4 border-b border-neutral-200 dark:border-neutral-800">
      <h2 className="text-base font-semibold text-neutral-900 dark:text-white">{title}</h2>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{children}</p>
    </div>
  )
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  )
}

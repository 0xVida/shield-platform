import { useState, useEffect } from "react"
import { useSearchParams, Link } from "react-router"
import {
  ShieldCheck,
  LockKey,
  Wallet,
  Cpu,
  CheckCircle,
  WarningCircle,
  ArrowRight,
  Sparkle,
  Copy,
  Check,
  ArrowsClockwise,
  Receipt,
  FileCode,
  ArrowSquareOut,
  MagnifyingGlass,
  SlidersHorizontal,
} from "@phosphor-icons/react"
import { Button } from "@workspace/ui/components/button"
import {
  addressToField,
  generateClaimProof,
  TESTNET_CONFIG,
  type ClaimProofOutput,
} from "@workspace/sdk"
import {
  ShieldVaultClient,
  submitTransaction,
  type SubmitStage,
} from "@workspace/sdk/chain"
import { useWallet } from "../context/wallet-context"
import { WalletConnectButton } from "../components/wallet-button"
import { api, type PreparedClaim } from "../lib/api"
import { formatAmount } from "../lib/amount"

// Depth-10 sample vector from batch.json (Batch 42, allocation 0)
const DEMO_CLAIM = {
  batchId: "42",
  amount: "50",
  secret: "111111111",
  leafIndex: 0,
  root: "0x0a031a7895e72614b467d604aef4ab02a493fa3ca23d142ea025dd8ce079c514",
  nullifierHash: "0x30128a873ad453f032bc29b9950c02a2d26aa9bc31b9c565771047e85037def0",
  pathElements: [
    "0x1d29cd3c383ccac60457708ac19860bf11e0f8e0763350e85b4e19cecc014ca8",
    "0x09ed35bca4579f2ec2d88ac5ae9ec69893cb4468b867c06d75431dc1454aa6dd",
    "0x1069673dcdb12263df301a6ff584a7ec261a44cb9dc68df067a4774460b1f1e1",
    "0x18f43331537ee2af2e3d758d50f72106467c6eea50371dd528d57eb2b856d238",
    "0x07f9d837cb17b0d36320ffe93ba52345f1b728571a568265caac97559dbc952a",
    "0x2b94cf5e8746b3f5c9631f4c5df32907a699c58c94b2ad4d7b5cec1639183f55",
    "0x2dee93c5a666459646ea7d22cca9e1bcfed71e6951b953611d11dda32ea09d78",
    "0x078295e5a22b84e982cf601eb639597b8b0515a88cb5ac7fa8a4aabe3c87349d",
    "0x2fa5e5f18f6027a6501bec864564472a616b2e274a41211a444cbe3a99f3cc61",
    "0x0e884376d0d8fd21ecb780389e941f66e45e7acce3e228ab3e2156a614fcd747",
  ],
  pathIndices: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
}

export default function ClaimPage() {
  const [searchParams] = useSearchParams()
  const { address: walletAddress, isConnected: isWalletConnected, signTransaction } = useWallet()

  // SDP Lookup states
  const [sdpBatchId, setSdpBatchId] = useState(searchParams.get("batch") || "")
  const [sdpRecipientId, setSdpRecipientId] = useState(searchParams.get("recipient") || "")
  const [isLookingUp, setIsLookingUp] = useState(false)
  const [retrievedClaim, setRetrievedClaim] = useState<PreparedClaim | null>(null)
  const [manualMode, setManualMode] = useState(
    !searchParams.get("recipient") && !searchParams.get("batch")
  )

  // Form states
  const [batchId, setBatchId] = useState(searchParams.get("batch") || DEMO_CLAIM.batchId)
  const [amount, setAmount] = useState(searchParams.get("amount") || DEMO_CLAIM.amount)
  const [secret, setSecret] = useState(searchParams.get("secret") || DEMO_CLAIM.secret)
  const [leafIndex, setLeafIndex] = useState(
    searchParams.get("index") ? Number(searchParams.get("index")) : DEMO_CLAIM.leafIndex
  )
  const [root, setRoot] = useState(searchParams.get("root") || DEMO_CLAIM.root)
  const [nullifierHash, setNullifierHash] = useState(
    searchParams.get("nullifier") || DEMO_CLAIM.nullifierHash
  )
  const [pathElements, setPathElements] = useState<string[]>(DEMO_CLAIM.pathElements)
  const [pathIndices, setPathIndices] = useState<number[]>(DEMO_CLAIM.pathIndices)
  const [recipient, setRecipient] = useState(
    searchParams.get("recipient") && searchParams.get("recipient")?.startsWith("G")
      ? searchParams.get("recipient")!
      : "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR"
  )

  // Flow & proving states
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [isProving, setIsProving] = useState(false)
  const [provingStage, setProvingStage] = useState("")
  const [proofOutput, setProofOutput] = useState<ClaimProofOutput | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Withdrawal / settlement states
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStage, setSubmitStage] = useState<SubmitStage | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)

  // Auto-lookup if batch and recipient parameters are present in URL
  useEffect(() => {
    const qBatch = searchParams.get("batch")
    const qRecipient = searchParams.get("recipient")
    if (qBatch && qRecipient) {
      handleLookupClaim(qBatch, qRecipient)
    }
  }, [searchParams])

  // Auto-fill connected wallet if recipient was unchanged default
  useEffect(() => {
    if (
      walletAddress &&
      (!recipient || recipient === "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR")
    ) {
      setRecipient(walletAddress)
    }
  }, [walletAddress])

  async function handleLookupClaim(lookupBatch: string, lookupRecipient: string) {
    if (!lookupBatch.trim() || !lookupRecipient.trim()) return
    setError(null)
    setIsLookingUp(true)
    try {
      const data = await api.prepareClaim({
        batchId: lookupBatch.trim(),
        recipient: lookupRecipient.trim(),
      })
      setRetrievedClaim(data)
      setBatchId(data.batchId)
      setAmount(data.amount)
      setSecret(data.secret)
      setLeafIndex(data.leafIndex)
      setRoot(data.root)
      setNullifierHash(data.nullifierHash)
      setPathElements(data.pathElements)
      setPathIndices(data.pathIndices)
      setManualMode(false)
    } catch (err: any) {
      console.warn("Could not retrieve claim from API:", err)
      setError(
        err?.message ||
          "Could not retrieve allocation. You can use manual entry or demo data."
      )
    } finally {
      setIsLookingUp(false)
    }
  }

  function loadDemoData() {
    setRetrievedClaim(null)
    setBatchId(DEMO_CLAIM.batchId)
    setAmount(DEMO_CLAIM.amount)
    setSecret(DEMO_CLAIM.secret)
    setLeafIndex(DEMO_CLAIM.leafIndex)
    setRoot(DEMO_CLAIM.root)
    setNullifierHash(DEMO_CLAIM.nullifierHash)
    setPathElements(DEMO_CLAIM.pathElements)
    setPathIndices(DEMO_CLAIM.pathIndices)
    setError(null)
    setManualMode(true)
  }

  async function handleGenerateProof() {
    setError(null)
    setIsProving(true)
    try {
      setProvingStage("1. Fetching circuit artifacts (WASM & ZKey)...")
      const wasmRes = await fetch("/zk/claim.wasm")
      if (!wasmRes.ok) throw new Error(`Could not load /zk/claim.wasm (HTTP ${wasmRes.status})`)
      const wasmBuffer = new Uint8Array(await wasmRes.arrayBuffer())

      const zkeyRes = await fetch("/zk/claim.zkey")
      if (!zkeyRes.ok) throw new Error(`Could not load /zk/claim.zkey (HTTP ${zkeyRes.status})`)
      const zkeyBuffer = new Uint8Array(await zkeyRes.arrayBuffer())

      setProvingStage("2. Encoding recipient address with SHA-256 (D4)...")
      await new Promise((r) => setTimeout(r, 200))

      setProvingStage("3. Synthesizing Groth16 zero-knowledge proof in WASM...")
      const out = await generateClaimProof(
        {
          root,
          nullifierHash,
          recipientAddress: recipient,
          amount,
          secret,
          batchId,
          pathElements,
          pathIndices,
        },
        wasmBuffer,
        zkeyBuffer
      )

      setProvingStage("4. Serializing BN254 points for Soroban pairing check...")
      await new Promise((r) => setTimeout(r, 200))

      setProofOutput(out)
      setStep(3)
    } catch (err: any) {
      console.error("Proof generation error:", err)
      setError(err?.message || "Failed to generate Groth16 proof")
    } finally {
      setIsProving(false)
      setProvingStage("")
    }
  }

  async function handleWithdraw() {
    if (!proofOutput || !walletAddress) return
    setError(null)
    setIsSubmitting(true)
    try {
      const client = new ShieldVaultClient({
        contractId: TESTNET_CONFIG.contracts.vault,
        networkPassphrase: TESTNET_CONFIG.networkPassphrase,
        rpcUrl: TESTNET_CONFIG.rpcUrl,
      })

      const cleanNullifier = nullifierHash.startsWith("0x")
        ? nullifierHash.slice(2)
        : nullifierHash
      const nullifierBigInt = BigInt("0x" + cleanNullifier)

      const tx = await client.buildWithdraw({
        source: walletAddress,
        batchId: BigInt(batchId),
        amount: BigInt(amount),
        recipient,
        nullifier: nullifierBigInt,
        proof: proofOutput.proofBytes,
      })

      const { hash } = await submitTransaction(tx, {
        signTransaction,
        onStage: (stage) => setSubmitStage(stage),
      })
      setTxHash(hash)
      setStep(4)
    } catch (err: any) {
      console.error("Withdrawal error:", err)
      setError(err?.message || "Withdrawal failed on-chain")
    } finally {
      setIsSubmitting(false)
      setSubmitStage(null)
    }
  }

  function copyProof() {
    if (!proofOutput) return
    navigator.clipboard.writeText(proofOutput.proofHex)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 antialiased selection:bg-emerald-500/30 selection:text-emerald-300">
      {/* Top Navigation */}
      <header className="border-b border-neutral-800/80 bg-neutral-900/40 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <ShieldCheck size={20} weight="duotone" />
              </div>
              <span className="font-semibold tracking-tight text-white flex items-center gap-2">
                ShieldZK
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-700/50 text-emerald-300 font-medium">
                  Testnet
                </span>
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div className="hidden sm:flex items-center gap-2 text-neutral-400">
              <span>Vault:</span>
              <code className="px-2 py-1 bg-neutral-800/60 border border-neutral-700/60 rounded text-neutral-300 font-mono">
                {TESTNET_CONFIG.contracts.vault.slice(0, 4)}...
                {TESTNET_CONFIG.contracts.vault.slice(-4)}
              </code>
            </div>

            <Link
              to="/batches"
              className="text-neutral-400 hover:text-white transition-colors duration-150"
            >
              Batches
            </Link>

            {/* Stellar Wallet Connect */}
            <WalletConnectButton onAddressSelect={(addr) => setRecipient(addr)} />
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-3xl mx-auto px-4 py-12">
        {/* Title & Subtitle */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-neutral-900 border border-neutral-800 text-neutral-300 text-xs font-medium mb-3">
            <Sparkle size={14} className="text-emerald-400" />
            Person 2 Delivery: Recipient Claim & Prover
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-2">
            Confidential Claim Portal
          </h1>
          <p className="text-neutral-400 text-sm max-w-lg mx-auto">
            Prove your private allocation entitlement without revealing your secret,
            opening commitment, or sender linkage to the public ledger.
          </p>
        </div>

        {/* Step Indicator */}
        <div className="grid grid-cols-4 gap-2 mb-8">
          {[
            { num: 1, title: "Allocation", icon: LockKey },
            { num: 2, title: "Recipient", icon: Wallet },
            { num: 3, title: "ZK Proof", icon: Cpu },
            { num: 4, title: "Withdraw", icon: CheckCircle },
          ].map((s) => {
            const Icon = s.icon
            const isActive = step === s.num
            const isCompleted = step > s.num
            return (
              <div
                key={s.num}
                onClick={() => isCompleted && setStep(s.num as any)}
                className={`p-3 rounded-xl border text-center transition-all ${
                  isCompleted
                    ? "bg-neutral-900/60 border-emerald-500/40 text-emerald-400 cursor-pointer"
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

        {/* Main Card */}
        <div className="bg-neutral-900/80 border border-neutral-800/80 rounded-2xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-72 h-72 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

          {error && (
            <div className="mb-6 p-4 rounded-xl bg-red-950/40 border border-red-800/60 text-red-300 text-xs flex items-start gap-3">
              <WarningCircle size={18} className="shrink-0 mt-0.5 text-red-400" />
              <div>
                <span className="font-semibold block mb-0.5">Verification Error</span>
                {error}
              </div>
            </div>
          )}

          {/* STEP 1: ALLOCATION INPUT & SDP RETRIEVAL */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-neutral-800">
                <div>
                  <h2 className="text-base font-semibold text-white">
                    1. Private Allocation Data
                  </h2>
                  <p className="text-xs text-neutral-400">
                    Retrieve via SDP invitation channel or enter claim credentials.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setManualMode(!manualMode)}
                    className="text-xs text-neutral-400 hover:text-white flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-neutral-800 transition-colors"
                  >
                    <SlidersHorizontal size={13} />
                    {manualMode ? "SDP Lookup" : "Custom Params"}
                  </button>
                  <button
                    type="button"
                    onClick={loadDemoData}
                    className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1.5 transition-colors font-medium bg-emerald-950/40 border border-emerald-800/40 px-2.5 py-1 rounded-md cursor-pointer"
                  >
                    <ArrowsClockwise size={13} />
                    Load Sample (Batch 42)
                  </button>
                </div>
              </div>

              {/* SDP Onboarding / Claim Retrieval Form */}
              {!manualMode && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-neutral-950/60 border border-neutral-800/80 space-y-3">
                    <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
                      <MagnifyingGlass size={15} />
                      <span>SDP Recipient Onboarding & Credential Retrieval</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-neutral-400 mb-1">
                          Batch ID (from disbursement invitation)
                        </label>
                        <input
                          type="text"
                          value={sdpBatchId}
                          onChange={(e) => setSdpBatchId(e.target.value)}
                          placeholder="e.g. 42"
                          className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-neutral-400 mb-1">
                          Recipient Reference (email, phone, or SDP ID)
                        </label>
                        <input
                          type="text"
                          value={sdpRecipientId}
                          onChange={(e) => setSdpRecipientId(e.target.value)}
                          placeholder="e.g. alice@example.com"
                          className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end pt-1">
                      <Button
                        disabled={isLookingUp || !sdpBatchId.trim() || !sdpRecipientId.trim()}
                        onClick={() => handleLookupClaim(sdpBatchId, sdpRecipientId)}
                        className="bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-xs font-semibold px-4 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                      >
                        {isLookingUp ? (
                          <>
                            <ArrowsClockwise size={13} className="animate-spin" />
                            Fetching Credential...
                          </>
                        ) : (
                          <>
                            <Receipt size={14} />
                            Retrieve Confidential Allocation
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Retrieved Allocation Card */}
                  {retrievedClaim && (
                    <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/30 space-y-3 animate-in fade-in-50">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-white flex items-center gap-2">
                          <CheckCircle size={16} className="text-emerald-400" />
                          Confidential Allocation Verified
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-700/50 text-emerald-300 font-medium">
                          {retrievedClaim.isSpent ? "Already Claimed" : "Ready to Claim"}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1 text-xs">
                        <div>
                          <span className="text-neutral-500 block text-[11px]">Private Allocation</span>
                          <span className="text-base font-bold text-emerald-400 font-mono">
                            {formatAmount(BigInt(retrievedClaim.amount))} Tokens
                          </span>
                        </div>
                        <div>
                          <span className="text-neutral-500 block text-[11px]">Recipient Reference</span>
                          <span className="text-xs font-medium text-neutral-200 truncate block">
                            {retrievedClaim.recipient}
                          </span>
                        </div>
                        <div>
                          <span className="text-neutral-500 block text-[11px]">Batch ID</span>
                          <span className="text-xs font-mono text-neutral-300">
                            #{retrievedClaim.batchId}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Manual parameter inputs (visible when manualMode is active or for sample) */}
              {manualMode && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                        Batch ID (u64)
                      </label>
                      <input
                        type="text"
                        value={batchId}
                        onChange={(e) => setBatchId(e.target.value)}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors font-mono"
                        placeholder="42"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                        Allocation Amount (Stroops / Base Units)
                      </label>
                      <input
                        type="text"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors font-mono font-medium text-emerald-400"
                        placeholder="50"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                        Private Secret (Opening)
                      </label>
                      <input
                        type="password"
                        value={secret}
                        onChange={(e) => setSecret(e.target.value)}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors font-mono"
                        placeholder="Secret key or random field element"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                        Leaf Index
                      </label>
                      <input
                        type="number"
                        value={leafIndex}
                        onChange={(e) => setLeafIndex(Number(e.target.value))}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors font-mono"
                        placeholder="0"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                      Merkle Tree Root
                    </label>
                    <input
                      type="text"
                      value={root}
                      onChange={(e) => setRoot(e.target.value)}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-neutral-300 focus:outline-none focus:border-emerald-500 transition-colors font-mono"
                      placeholder="0x..."
                    />
                  </div>
                </div>
              )}

              <div className="pt-2 flex justify-end">
                <Button
                  onClick={() => setStep(2)}
                  className="bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold px-5 flex items-center gap-2 cursor-pointer"
                >
                  Continue to Recipient Binding
                  <ArrowRight size={16} />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 2: RECIPIENT WALLET BINDING */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="pb-4 border-b border-neutral-800">
                <h2 className="text-base font-semibold text-white">
                  2. Recipient Wallet Binding (D4)
                </h2>
                <p className="text-xs text-neutral-400">
                  Your Stellar payout address is cryptographically bound inside the circuit constraints,
                  guaranteeing miners or relayers cannot front-run or redirect your funds.
                </p>
              </div>

              {/* Wallet connection banner inside Step 2 */}
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-neutral-950/80 border border-neutral-800">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                    <Wallet size={20} weight="duotone" />
                  </div>
                  <div>
                    <div className="text-xs font-medium text-white">Stellar Wallet (Freighter)</div>
                    <div className="text-[11px] text-neutral-400">
                      {isWalletConnected
                        ? `Connected: ${walletAddress?.slice(0, 6)}...${walletAddress?.slice(-4)}`
                        : "Connect Freighter wallet to auto-bind your recipient address"}
                    </div>
                  </div>
                </div>
                {isWalletConnected ? (
                  <button
                    type="button"
                    onClick={() => walletAddress && setRecipient(walletAddress)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors cursor-pointer"
                  >
                    Use Wallet Address
                  </button>
                ) : (
                  <WalletConnectButton onAddressSelect={(addr) => setRecipient(addr)} />
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-medium text-neutral-300">
                      Payout Recipient Stellar Address (G... or C...)
                    </label>
                    {isWalletConnected && recipient === walletAddress && (
                      <span className="text-[11px] text-emerald-400 flex items-center gap-1 font-medium">
                        <Check size={12} /> Bound to Connected Wallet
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors font-mono"
                    placeholder="GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR"
                  />
                </div>

                <div className="p-4 rounded-xl bg-neutral-950/60 border border-neutral-800/80 text-xs space-y-2">
                  <div className="text-neutral-400 flex items-center gap-2">
                    <Receipt size={16} className="text-emerald-400" />
                    <span>Summary of Claim Statement:</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-neutral-300 pt-1 font-mono text-[11px]">
                    <div>
                      <span className="text-neutral-500 block">Batch ID:</span> {batchId}
                    </div>
                    <div>
                      <span className="text-neutral-500 block">Amount:</span> {amount} units
                    </div>
                    <div>
                      <span className="text-neutral-500 block">Leaf Slot:</span> #{leafIndex}
                    </div>
                    <div>
                      <span className="text-neutral-500 block">Merkle Path:</span>{" "}
                      {pathElements.length} levels
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-2 flex justify-between items-center">
                <Button
                  variant="outline"
                  onClick={() => setStep(1)}
                  className="border-neutral-800 text-neutral-300 hover:bg-neutral-800 cursor-pointer"
                >
                  Back
                </Button>
                <Button
                  disabled={isProving || !recipient}
                  onClick={handleGenerateProof}
                  className="bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold px-5 flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isProving ? (
                    <>
                      <ArrowsClockwise size={16} className="animate-spin" />
                      Generating Proof...
                    </>
                  ) : (
                    <>
                      <Cpu size={16} />
                      Generate Zero-Knowledge Proof
                    </>
                  )}
                </Button>
              </div>

              {isProving && (
                <div className="mt-4 p-3 rounded-lg bg-emerald-950/20 border border-emerald-900/40 text-emerald-400 text-xs flex items-center gap-2 animate-pulse">
                  <Cpu size={15} />
                  <span>{provingStage}</span>
                </div>
              )}
            </div>
          )}

          {/* STEP 3: PROOF GENERATED & READY */}
          {step === 3 && proofOutput && (
            <div className="space-y-6">
              <div className="pb-4 border-b border-neutral-800 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-white flex items-center gap-2">
                    <CheckCircle size={20} className="text-emerald-400" />
                    3. Proof Generated Successfully!
                  </h2>
                  <p className="text-xs text-neutral-400">
                    Groth16 proof is verified off-chain and serialized for Soroban BN254.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={copyProof}
                  className="text-xs text-neutral-300 hover:text-white flex items-center gap-1.5 bg-neutral-800/80 px-2.5 py-1 rounded-md transition-colors cursor-pointer"
                >
                  {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  {copied ? "Copied" : "Copy Hex"}
                </button>
              </div>

              {/* Proof stats */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3 bg-neutral-950 rounded-xl border border-neutral-800">
                  <span className="text-neutral-500 block text-[11px]">Proof Size</span>
                  <span className="font-mono font-medium text-white">256 bytes (A || B || C)</span>
                </div>
                <div className="p-3 bg-neutral-950 rounded-xl border border-neutral-800">
                  <span className="text-neutral-500 block text-[11px]">Public Inputs</span>
                  <span className="font-mono font-medium text-white">4 elements</span>
                </div>
                <div className="p-3 bg-neutral-950 rounded-xl border border-neutral-800">
                  <span className="text-neutral-500 block text-[11px]">Bound Nullifier</span>
                  <span className="font-mono font-medium text-white truncate block">
                    {nullifierHash.slice(0, 10)}...{nullifierHash.slice(-6)}
                  </span>
                </div>
              </div>

              {/* Public Signals Preview */}
              <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2">
                <div className="text-xs font-semibold text-neutral-300 flex items-center gap-2">
                  <FileCode size={16} className="text-emerald-400" />
                  Public Input Order Passed to Soroban Verifier:
                </div>
                <div className="font-mono text-[11px] text-neutral-400 space-y-1">
                  <div>[0] root: <span className="text-neutral-200">{root.slice(0, 24)}...</span></div>
                  <div>[1] nullifier: <span className="text-neutral-200">{nullifierHash.slice(0, 24)}...</span></div>
                  <div>[2] recipient (D4): <span className="text-neutral-200">{proofOutput.recipientField.toString().slice(0, 24)}...</span></div>
                  <div>[3] amount: <span className="text-emerald-400 font-semibold">{amount} units</span></div>
                </div>
              </div>

              <div className="pt-2 flex justify-between items-center">
                <Button
                  variant="outline"
                  onClick={() => setStep(2)}
                  className="border-neutral-800 text-neutral-300 hover:bg-neutral-800 cursor-pointer"
                >
                  Back
                </Button>
                <Button
                  disabled={isSubmitting || !walletAddress}
                  onClick={handleWithdraw}
                  className="bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold px-5 flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <ArrowsClockwise size={16} className="animate-spin" />
                      {submitStage ? `${submitStage}...` : "Submitting Claim..."}
                    </>
                  ) : !walletAddress ? (
                    <>
                      <Wallet size={16} />
                      Connect Wallet to Claim
                    </>
                  ) : (
                    <>
                      <CheckCircle size={16} />
                      Sign with Freighter & Claim
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* STEP 4: SUCCESSFUL SETTLEMENT */}
          {step === 4 && (
            <div className="space-y-6 text-center py-6">
              <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-center text-emerald-400 mx-auto">
                <CheckCircle size={36} weight="duotone" />
              </div>

              <div>
                <h2 className="text-xl font-bold text-white mb-1">
                  Claim Successfully Verified!
                </h2>
                <p className="text-xs text-neutral-400 max-w-md mx-auto">
                  The on-chain verifier confirmed the Merkle inclusion proof and nullifier derivation.
                  Funds have been allocated to your recipient address.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 text-xs text-left max-w-lg mx-auto space-y-2">
                <div className="text-neutral-400">Transaction Status:</div>
                <div className="font-mono text-emerald-400 text-xs break-all">
                  {txHash}
                </div>
                <div className="text-[11px] text-neutral-500 pt-2 border-t border-neutral-900">
                  Vault Contract:{" "}
                  <code className="text-neutral-400">{TESTNET_CONFIG.contracts.vault}</code>
                </div>
              </div>

              <div className="pt-4 flex justify-center gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setStep(1)
                    setProofOutput(null)
                    setTxHash(null)
                    setRetrievedClaim(null)
                  }}
                  className="border-neutral-800 text-neutral-300 hover:bg-neutral-800 cursor-pointer"
                >
                  Start Another Claim
                </Button>
                {txHash && !txHash.startsWith("Simulated") && (
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold px-4 py-2 rounded-lg text-sm inline-flex items-center gap-1.5 transition-colors cursor-pointer"
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

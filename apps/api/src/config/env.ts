import { StrKey } from "@stellar/stellar-sdk"
import type { VaultConnection } from "@workspace/sdk/chain"
import { z } from "zod"

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  // A plain URL check would reject multi-host replica set URIs, so only the scheme is checked.
  MONGODB_URI: z
    .string()
    .regex(
      /^mongodb(\+srv)?:\/\//,
      "must start with mongodb:// or mongodb+srv://"
    ),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    )
    .pipe(z.array(z.url())),
  // Encrypts stored claim data, which holds each recipient's secret. 32 random bytes,
  // base64: `openssl rand -base64 32`. Stored claim data can't be read without it.
  // Unset, the batch routes (/v1/batches) are off.
  CLAIM_DATA_KEY: z
    .string()
    .regex(
      /^[A-Za-z0-9+/]{43}=$/,
      "must be 32 bytes in base64 (openssl rand -base64 32)"
    )
    .transform((value) => Buffer.from(value, "base64"))
    .optional(),
  // shield-contracts' circuits directory. Batches are proved with its
  // lib/conservation.js and the conservation_main keys that
  // scripts/groth16-setup.sh wrote to build/. Unset, proving is off.
  CONSERVATION_CIRCUITS_DIR: z.string().min(1).optional(),
  // The ShieldVault that batches are funded on, read through @workspace/sdk/chain.
  // All three or none; unset, funding can't be confirmed.
  STELLAR_RPC_URL: z.url().optional(),
  STELLAR_NETWORK_PASSPHRASE: z.string().min(1).optional(),
  VAULT_CONTRACT_ID: z
    .string()
    .refine(StrKey.isValidContract, "must be a contract address (C...)")
    .optional(),
  // While the vault is configured, its events are indexed into MongoDB. The first
  // start reads from this ledger; unset, from the oldest the RPC still has (about
  // a week back on testnet).
  INDEXER_START_LEDGER: z.coerce.number().int().min(1).optional(),
  // How often the indexer checks for new events. Unset, every 5 s (about a ledger).
  INDEXER_POLL_MS: z.coerce.number().int().min(1000).optional(),
})

const CHAIN_KEYS = [
  "STELLAR_RPC_URL",
  "STELLAR_NETWORK_PASSPHRASE",
  "VAULT_CONTRACT_ID",
] as const

const CheckedEnvSchema = EnvSchema.superRefine((env, ctx) => {
  const set = CHAIN_KEYS.filter((key) => env[key] !== undefined)
  if (set.length > 0 && set.length < CHAIN_KEYS.length) {
    ctx.addIssue({
      code: "custom",
      path: [CHAIN_KEYS.find((key) => env[key] === undefined)!],
      message: `set all of ${CHAIN_KEYS.join(", ")}, or none`,
    })
  }
})

export type Config = z.output<typeof EnvSchema>

/** Parses the environment, throwing on invalid values so the server fails at boot. */
export function loadConfig(
  env: Record<string, string | undefined> = process.env
): Config {
  const result = CheckedEnvSchema.safeParse(env)
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`)
  }
  return result.data
}

/** The vault for @workspace/sdk/chain's ShieldVaultClient, if it's configured. */
export function vaultConnection(
  config: Pick<
    Config,
    "STELLAR_RPC_URL" | "STELLAR_NETWORK_PASSPHRASE" | "VAULT_CONTRACT_ID"
  >
): VaultConnection | undefined {
  const rpcUrl = config.STELLAR_RPC_URL
  const networkPassphrase = config.STELLAR_NETWORK_PASSPHRASE
  const contractId = config.VAULT_CONTRACT_ID
  if (!rpcUrl || !networkPassphrase || !contractId) return undefined
  return {
    contractId,
    networkPassphrase,
    rpcUrl,
    allowHttp: rpcUrl.startsWith("http://"),
  }
}

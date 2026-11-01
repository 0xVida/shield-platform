import { existsSync } from "node:fs"
import { createServer } from "node:http"

import { ShieldVaultClient } from "@workspace/sdk/chain"

import { createApp } from "./app"
import { loadConfig, vaultConnection } from "./config/env"
import { MongoBatchStore } from "./db/batches"
import { connectMongo } from "./db/mongo"
import { MongoVaultEventStore } from "./db/vault-events"
import { VaultIndexer } from "./indexer/vault-indexer"
import { createLogger } from "./lib/logger"
import {
  CONSERVATION_CIRCUIT,
  conservationArtifacts,
  nodeConservationProver,
} from "./proving/conservation"
import { ConservationProofs } from "./proving/proofs"

const SHUTDOWN_TIMEOUT_MS = 10_000

const config = loadConfig()
const logger = createLogger(config)

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "unhandled rejection")
  process.exit(1)
})
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception")
  process.exit(1)
})

const mongo = await connectMongo(config.MONGODB_URI).catch((err: unknown) => {
  logger.fatal({ err }, "could not connect to MongoDB")
  process.exit(1)
})

const batches = new MongoBatchStore(mongo.db)
await batches.ensureIndexes().catch((err: unknown) => {
  logger.fatal({ err }, "could not create MongoDB indexes")
  process.exit(1)
})

const claimDataKey = config.CLAIM_DATA_KEY
if (!claimDataKey) {
  logger.warn("the batch routes are off: CLAIM_DATA_KEY isn't set")
}

let proofs: ConservationProofs | undefined
const circuitsDir = config.CONSERVATION_CIRCUITS_DIR
if (circuitsDir && claimDataKey) {
  const artifacts = conservationArtifacts(circuitsDir, CONSERVATION_CIRCUIT)
  const missing = Object.values(artifacts).filter((file) => !existsSync(file))
  if (missing.length > 0) {
    logger.fatal({ missing }, "conservation prover files not found")
    process.exit(1)
  }
  proofs = new ConservationProofs({
    store: batches,
    prover: nodeConservationProver(circuitsDir),
    claimDataKey,
    logger,
  })
  // Proofs a restart interrupted start over
  for (const batch of await batches.withStatus("proving")) {
    proofs.start(batch.batchId)
  }
} else if (claimDataKey) {
  logger.warn("proving is off: CONSERVATION_CIRCUITS_DIR isn't set")
}

const connection = vaultConnection(config)
const vault = connection ? new ShieldVaultClient(connection) : undefined
let indexer: VaultIndexer | undefined
if (connection && vault) {
  const vaultEvents = new MongoVaultEventStore(mongo.db)
  await vaultEvents.ensureIndexes().catch((err: unknown) => {
    logger.fatal({ err }, "could not create MongoDB indexes")
    process.exit(1)
  })
  indexer = new VaultIndexer({
    contractId: connection.contractId,
    source: vault,
    store: vaultEvents,
    logger,
    startLedger: config.INDEXER_START_LEDGER,
    pollIntervalMs: config.INDEXER_POLL_MS,
  })
  indexer.start()
  logger.info({ contractId: connection.contractId }, "indexing vault events")
} else {
  logger.warn(
    "funding can't be confirmed and vault events aren't indexed: the vault isn't configured"
  )
}

const app = createApp({
  config,
  logger,
  readinessChecks: {
    mongo: async () => {
      await mongo.db.command({ ping: 1 })
    },
  },
  batches,
  proofs,
  vault,
})

const server = createServer(app)

server.on("error", (err) => {
  logger.fatal({ err }, "server error")
  process.exit(1)
})

server.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, "api listening")
})

let shuttingDown = false

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, "shutting down")

  const forceExit = setTimeout(() => {
    logger.error("shutdown timed out, forcing exit")
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS)
  forceExit.unref()

  try {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    )
    // Let a poll in progress finish its writes before MongoDB closes
    await indexer?.stop()
    await mongo.client.close()
    logger.info("shutdown complete")
    process.exit(0)
  } catch (err) {
    logger.error({ err }, "shutdown failed")
    process.exit(1)
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void shutdown(signal))
}

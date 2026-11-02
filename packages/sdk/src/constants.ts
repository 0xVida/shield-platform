/**
 * Deployed ShieldZK contract addresses and default network parameters for Stellar Testnet.
 */
export const TESTNET_CONFIG = {
  networkPassphrase: "Test SDF Network ; September 2015",
  rpcUrl: "https://soroban-testnet.stellar.org",
  contracts: {
    vault: "CAHB6YK4E6R2MLIJQQJCTTK5VJZRUGGXXVUUQGK7Y5PNKEECF2UWJN3L",
    claimVerifier: "CCKKXDUSPGADSFYKEYM4C2APHGIJ3M4L5HRPSDPPKFOMRTTRVZTZCUAB",
    conservationVerifier: "CAV3PURY3AE2GI6VPUXGLEOC3DL7DFJUPI6G3ZS3SGGKHXVQQAAEPOPF",
    nativeAsset: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  },
} as const

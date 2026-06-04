// Top-level network switch — Zo's UX. One `setNetwork(token)` spans both
// chains: the token implies the chain (like the gateway resolver infers chain
// from id shape). Solana tokens pick devnet/mainnet; EVM tokens select the
// adapter + sub-network. `'eth'` is shorthand for the EVM default (sepolia).
//
// This configures the *global* read path (the standalone read functions and
// the gateway). Writes still flow through a `GitClient`, whose constructor
// wires its own signer + connection/provider.

import { initChain, setChain } from "./chain";
import type { EthNetwork } from "./chain";
import { setSolanaGatewayNetwork } from "./gateway";

export type SolanaNetwork = "devnet" | "mainnet";

/** Every token `setNetwork` accepts. `'eth'` ⇒ sepolia (EVM default). */
export type NetworkToken = SolanaNetwork | "eth" | EthNetwork;

// EVM tokens → concrete network. `eth` is the default-EVM alias.
const EVM_TOKENS: Record<string, EthNetwork> = {
  eth: "sepolia",
  sepolia: "sepolia",
  monad: "monad",
  monadTestnet: "monadTestnet",
};

/**
 * Switch the active chain + network from a single token.
 *
 *   setNetwork('mainnet')      // Solana mainnet
 *   setNetwork('devnet')       // Solana devnet
 *   setNetwork('eth')          // EVM, sepolia (default)
 *   setNetwork('monad', { rpcUrl })   // EVM, monad, custom RPC
 *
 * `rpcUrl` only applies to EVM tokens (the EVM adapter holds the provider);
 * Solana reads resolve their RPC from the gateway / `setRpcUrl`.
 */
export function setNetwork(token: NetworkToken, options?: { rpcUrl?: string }): void {
  const evm = EVM_TOKENS[token];
  if (evm) {
    setChain("eth");
    // The eth adapter's init() wires iqlabs network + the gateway network.
    initChain({ chain: "eth", network: evm, rpcUrl: options?.rpcUrl });
    return;
  }
  // Solana: reads need no Connection here (gateway / global RPC). Writes use
  // the GitClient's own connection, set when the client is constructed.
  setChain("solana");
  setSolanaGatewayNetwork(token as SolanaNetwork);
}

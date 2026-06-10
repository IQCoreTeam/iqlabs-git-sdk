// L1.5 — iq-gateway HTTP helpers. Multi-chain: the gateway at
// gateway.iqlabs.dev serves Solana + EVM (sepolia / monad / monadTestnet) in
// one process, routing per request by `?network=` or by id shape.
//
// The chain adapters dispatch reads through here first; on a null return they
// fall back to direct RPC. Writers fire-and-forget a notify so the gateway can
// prepend the new row to its head-page cache without waiting on RPC indexing.
//
// Read shapes:
//   Solana table   GET /table/{pda}/rows
//   EVM table      GET /table/{dbRootId}/{tableName}/rows?network=<evmnet>
//   blob (either)  GET /data/{txId}            (id shape auto-routes; an EVM
//                  network override is appended for non-default EVM chains)
//
// Configuration precedence for the gateway URL (high → low):
//   1. setGatewayUrls([...])    — explicit list ([] disables)
//   2. IQGIT_GATEWAYS env (csv)
//   3. active chain / network    — EVM ⇒ the multi-chain mainnet gateway;
//                                  Solana ⇒ devnet/mainnet by override or RPC
//   4. Mainnet default           — gateway.iqlabs.dev
//
// Everything here is best-effort: an unreachable/disabled gateway never breaks
// the SDK.

import { getRpcUrl } from "@iqlabs-official/solana-sdk";
import type { EthNetwork } from "./chain";

const MAINNET_GATEWAY = "https://gateway.iqlabs.dev";
const DEVNET_GATEWAY = "https://dev-gateway.iqlabs.dev";
const REQ_TIMEOUT_MS = 5000;

let runtimeGateways: string[] | null = null;
let solanaNetwork: "mainnet" | "devnet" | null = null;
let activeChain: "solana" | "eth" = "solana";
let ethNetwork: EthNetwork = "sepolia";

/** Pin the gateway URL list explicitly. Highest precedence. Pass `[]` to
 *  disable gateway dispatch entirely (RPC-only mode). */
export function setGatewayUrls(urls: string[]): void {
  runtimeGateways = urls.length > 0 ? urls : null;
}

/** Point the gateway at a Solana network. Used by the top-level `setNetwork`
 *  and as the back-compat `setNetwork("mainnet"|"devnet")` shim. */
export function setSolanaGatewayNetwork(network: "mainnet" | "devnet"): void {
  activeChain = "solana";
  solanaNetwork = network;
}

/** Point the gateway at an EVM network. Called by the eth adapter's `init()`
 *  and the top-level `setNetwork`. */
export function setEthGatewayNetwork(network: EthNetwork): void {
  activeChain = "eth";
  ethNetwork = network;
}

function inferSolanaNetwork(): "mainnet" | "devnet" {
  if (solanaNetwork) return solanaNetwork;
  const u = getRpcUrl().toLowerCase();
  if (u.includes("devnet") || u.includes("testnet")) return "devnet";
  return "mainnet";
}

export function getGatewayUrls(): string[] {
  if (runtimeGateways) return runtimeGateways;

  const env = (typeof process !== "undefined" && process.env?.IQGIT_GATEWAYS) ?? "";
  if (env) return env.split(",").map((s) => s.trim()).filter(Boolean);

  // The multi-chain gateway lives on the mainnet host and serves every EVM
  // network behind `?network=`.
  if (activeChain === "eth") return [MAINNET_GATEWAY];
  return inferSolanaNetwork() === "devnet" ? [DEVNET_GATEWAY] : [MAINNET_GATEWAY];
}

async function tryGateways<T>(
  path: (gw: string) => string,
  parse: (res: Response) => Promise<T>,
): Promise<T | null> {
  for (const gw of getGatewayUrls()) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
      const res = await fetch(path(gw), { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) return await parse(res);
    } catch {
      // Try the next gateway.
    }
  }
  return null;
}

function rowsQuery(options?: { limit?: number; before?: string }, network?: string): string {
  const qs = new URLSearchParams();
  if (options?.limit) qs.set("limit", String(options.limit));
  if (options?.before) qs.set("before", options.before);
  if (network) qs.set("network", network);
  return qs.toString() ? `?${qs}` : "";
}

/** Solana table read: rows for a table PDA via /table/:pda/rows. Null when no
 *  gateway is configured or all fail — caller falls back to RPC. */
export async function readRowsViaGateway(
  pdaBase58: string,
  options?: { limit?: number; before?: string },
): Promise<Array<Record<string, unknown>> | null> {
  const suffix = rowsQuery(options);
  return tryGateways(
    (gw) => `${gw}/table/${pdaBase58}/rows${suffix}`,
    async (res) => {
      const json = (await res.json()) as { rows?: unknown[] };
      return (json.rows ?? []) as Array<Record<string, unknown>>;
    },
  );
}

/** EVM table read: rows for a `(dbRootId, tableName)` via
 *  /table/:root/:name/rows?network=<evmnet>. */
export async function readRowsByNameViaGateway(
  dbRootId: string,
  tableName: string,
  network: EthNetwork,
  options?: { limit?: number; before?: string },
): Promise<Array<Record<string, unknown>> | null> {
  const suffix = rowsQuery(options, network);
  return tryGateways(
    (gw) => `${gw}/table/${dbRootId}/${tableName}/rows${suffix}`,
    async (res) => {
      const json = (await res.json()) as { rows?: unknown[] };
      return (json.rows ?? []) as Array<Record<string, unknown>>;
    },
  );
}

/** Raw codeIn payload via /data/:id. The id shape auto-routes (base58 →
 *  Solana, `0x` → EVM); `network` pins a non-default EVM chain (monad). */
export async function readCodeInViaGateway(
  txId: string,
  network?: EthNetwork,
): Promise<{ data: string | null; metadata: string } | null> {
  const suffix = network ? `?network=${network}` : "";
  return tryGateways(
    (gw) => `${gw}/data/${txId}${suffix}`,
    async (res) => {
      const json = (await res.json()) as { data?: string | null; metadata?: string };
      return { data: json.data ?? null, metadata: json.metadata ?? "" };
    },
  );
}

/** Hit every gateway's /notify after a successful write so it injects the new
 *  row into its head-page cache without waiting on RPC sig indexing. Includes
 *  the row body so the gateway skips the RPC roundtrip.
 *
 *  Awaitable: resolves once all gateways have responded (or timed out). Errors
 *  are swallowed — the row is already on-chain, gateway hydration is
 *  opportunistic — but the caller CAN await this to guarantee the notify
 *  actually goes out before a short-lived process (e.g. a CLI) exits. Each
 *  request is bounded by REQ_TIMEOUT_MS so a dead gateway can't hang the write.
 */
export async function notifyGateways(
  tableKey: string,
  txSig: string,
  row: object,
  signer: string,
): Promise<void> {
  const network = activeChain === "eth" ? ethNetwork : undefined;
  const body = JSON.stringify({ txSignature: txSig, row, signer, network });
  const suffix = network ? `?network=${network}` : "";
  await Promise.allSettled(
    getGatewayUrls().map((gw) =>
      fetch(`${gw}/table/${tableKey}/notify${suffix}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(REQ_TIMEOUT_MS),
      }).catch(() => {}),
    ),
  );
}

/** Force every gateway to drop its cached head page for a table by issuing a
 *  `?fresh=true` read — the gateway re-fetches from chain and re-seeds its
 *  cache, so the NEXT plain (cached) read by anyone (e.g. browser.iqlabs.dev)
 *  sees the just-written row. Pairs with notifyGateways on the write side:
 *  notify prepends the row optimistically, fresh re-reads against RPC. Together
 *  the next reader gets the new row regardless of RPC indexing lag or which
 *  gateway it happens to hit. Best-effort + bounded; never throws. */
export async function bustTableCache(tableKey: string): Promise<void> {
  const network = activeChain === "eth" ? ethNetwork : undefined;
  const qs = new URLSearchParams({ fresh: "true" });
  if (network) qs.set("network", network);
  await Promise.allSettled(
    getGatewayUrls().map((gw) =>
      fetch(`${gw}/table/${tableKey}/rows?${qs}`, {
        signal: AbortSignal.timeout(REQ_TIMEOUT_MS),
      }).catch(() => {}),
    ),
  );
}

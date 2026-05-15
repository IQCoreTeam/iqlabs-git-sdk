// L1.5 — iq-gateway HTTP helpers.
//
// chain.ts dispatches reads through here first; on a null return it falls
// back to direct RPC. Writers fire-and-forget a notify so the gateway can
// prepend the new row to its head-page cache without waiting on RPC
// indexing.
//
// Configuration precedence (high → low):
//   1. setGatewayUrls([...])         — explicit URL list
//   2. IQGIT_GATEWAYS env (csv)      — deployment-side pinning
//   3. setNetwork("devnet"|"mainnet") + the network's default gateway
//   4. RPC URL hostname inference (`devnet` / `testnet` substring → devnet)
//   5. Mainnet default                — gateway.iqlabs.dev
//
// Everything here is best-effort: an unreachable, misconfigured, or
// disabled gateway never breaks the SDK.

import { getRpcUrl } from "@iqlabs-official/solana-sdk";

const MAINNET_GATEWAY = "https://gateway.iqlabs.dev";
const DEVNET_GATEWAY = "https://dev-gateway.iqlabs.dev";
const REQ_TIMEOUT_MS = 5000;

let runtimeGateways: string[] | null = null;
let networkOverride: "mainnet" | "devnet" | null = null;

/** Pin the gateway URL list explicitly. Highest precedence. Pass `[]` to
 *  disable gateway dispatch entirely (RPC-only mode). */
export function setGatewayUrls(urls: string[]): void {
  runtimeGateways = urls.length > 0 ? urls : null;
}

/** Pin the network label when the RPC URL doesn't reveal it (private nodes,
 *  proxies, etc.). Has no effect when setGatewayUrls() is also set. */
export function setNetwork(network: "mainnet" | "devnet"): void {
  networkOverride = network;
}

function inferNetwork(): "mainnet" | "devnet" {
  if (networkOverride) return networkOverride;
  const u = getRpcUrl().toLowerCase();
  if (u.includes("devnet") || u.includes("testnet")) return "devnet";
  return "mainnet";
}

export function getGatewayUrls(): string[] {
  if (runtimeGateways) return runtimeGateways;

  const env = (typeof process !== "undefined" && process.env?.IQGIT_GATEWAYS) ?? "";
  if (env) return env.split(",").map((s) => s.trim()).filter(Boolean);

  return inferNetwork() === "devnet" ? [DEVNET_GATEWAY] : [MAINNET_GATEWAY];
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

/** Fetch rows for a table PDA via /table/:pda/rows. Returns null when no
 *  gateway is configured or all of them fail — caller falls back to RPC. */
export async function readRowsViaGateway(
  pdaBase58: string,
  options?: { limit?: number; before?: string },
): Promise<Array<Record<string, unknown>> | null> {
  const qs = new URLSearchParams();
  if (options?.limit) qs.set("limit", String(options.limit));
  if (options?.before) qs.set("before", options.before);
  const suffix = qs.toString() ? `?${qs}` : "";

  return tryGateways(
    (gw) => `${gw}/table/${pdaBase58}/rows${suffix}`,
    async (res) => {
      const json = (await res.json()) as { rows?: unknown[] };
      return (json.rows ?? []) as Array<Record<string, unknown>>;
    },
  );
}

/** Fetch raw codeIn payload via /data/:sig. Gateway returns a superset of
 *  what the SDK's readCodeIn produces; we extract just the matching fields. */
export async function readCodeInViaGateway(
  txSig: string,
): Promise<{ data: string | null; metadata: string } | null> {
  return tryGateways(
    (gw) => `${gw}/data/${txSig}`,
    async (res) => {
      const json = (await res.json()) as { data?: string | null; metadata?: string };
      return { data: json.data ?? null, metadata: json.metadata ?? "" };
    },
  );
}

/** Fire-and-forget /notify after a successful write. Includes the row body
 *  so the gateway can inject without an RPC roundtrip. Errors are swallowed
 *  — the row is already on-chain, gateway hydration is opportunistic. */
export function notifyGateways(
  pdaBase58: string,
  txSig: string,
  row: object,
  signer: string,
): void {
  const body = JSON.stringify({ txSignature: txSig, row, signer });
  for (const gw of getGatewayUrls()) {
    fetch(`${gw}/table/${pdaBase58}/notify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }).catch(() => {});
  }
}

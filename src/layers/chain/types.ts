// L1 — the chain-neutral seam. `ChainOps` is the exact intersection that the
// L2/L3 layers (storage / commit / repo / client) need from a backing chain.
// Solana and EVM each provide an adapter implementing this; the selector in
// `./index.ts` picks the active one. Everything above L1 deals only in
// **hints** (chain-neutral table keys from `core/seed.ts`) and opaque
// `TableRef`s — never a PDA, never a `(dbRootId, tableName)` pair directly.
//
// Design rules:
//  • No `Connection` / provider anywhere in these signatures. Each adapter
//    holds its own runtime, wired once via `init()`. (Solana keeps a
//    `Connection`; EVM's ethers `Signer` carries its provider.)
//  • Writes take a `GitSigner` (the per-chain signer union) per call.
//  • Reads are keyed by hint, or by an opaque `TableRef` for callers that
//    already resolved one (a `.sol` record, a cached pointer).

import type { Connection } from "@solana/web3.js";
import type {
  SessionSpeedOption,
  SignerInput,
} from "@iqlabs-official/solana-sdk/utils";
import type { Signer as EthSigner } from "ethers";

/** Re-exported solana-sdk speed dial — preset name or raw RPS/concurrency
 *  override. EVM ignores it (no client-side chunk pacing on that path). */
export type SessionSpeed = SessionSpeedOption;

/** A row as the upper layers consume it: the parsed JSON body of a table row. */
export type Row = Record<string, unknown>;

export interface ReadOptions {
  limit?: number;
  before?: string;
}

/**
 * Opaque handle to a table. Solana resolves a hint to a `PublicKey` PDA; EVM
 * resolves it to `{ dbRootId, tableName }`. Callers above L1 treat it as a
 * black box and only ever hand it back to `readRowsByRef`.
 */
export type TableRef = unknown;

/**
 * A signer accepted by the active chain. The Solana adapter narrows to
 * `SignerInput` (Keypair / wallet adapter); the EVM adapter narrows to an
 * ethers `Signer`. Kept as a union here so one `ChainOps` interface can be
 * satisfied by both — Phase 2 threads this through the client surface.
 */
export type GitSigner = SignerInput | EthSigner;

/** EVM sub-networks the eth adapter understands (mirrors ethereum-sdk). */
export type EthNetwork = "sepolia" | "monad" | "monadTestnet";

/**
 * Per-chain runtime config handed to `ChainOps.init()`. Discriminated by
 * `chain` so each adapter narrows to exactly what it needs and importing the
 * inactive adapter never touches the other chain's runtime.
 */
export type ChainConfig =
  | { chain: "solana"; connection: Connection }
  | { chain: "eth"; network: EthNetwork; rpcUrl?: string };

/**
 * The L1 surface. One method set, two adapters. Reads prefer the iq-gateway
 * HTTP cache where an adapter wires it (Solana today; EVM in Phase 3) and fall
 * back to direct RPC.
 */
export interface ChainOps {
  readonly kind: "solana" | "eth";

  /** Wire chain-specific runtime. Idempotent; safe to call per GitClient. */
  init(cfg: ChainConfig): void;

  // ---- blob storage ----

  /** Upload a codeIn payload. Returns its tx id (base58 sig / `0x` hash). */
  codeIn(
    signer: GitSigner,
    data: string | string[],
    filename: string,
    filetype: string,
    onProgress?: (percent: number) => void,
    speed?: SessionSpeed,
  ): Promise<string>;

  /** Read a codeIn payload back by tx id. `metadata` is opaque to callers. */
  readCodeIn(txId: string): Promise<{ data: string | null; metadata: string }>;

  // ---- table reads ----

  readRows(hint: string, options?: ReadOptions): Promise<Row[]>;
  readRowsByRef(ref: TableRef, options?: ReadOptions): Promise<Row[]>;
  readLatestRow(hint: string): Promise<Row | null>;

  // ---- table writes ----

  /** Initialize the `iq-git-v1` DbRoot if absent. Null when already present. */
  ensureDbRoot(signer: GitSigner): Promise<string | null>;

  /** Create a table at `hint`. `writers` omitted ⇒ open (anyone can write);
   *  an array ⇒ restrict writes to those addresses. Null if already present. */
  createTable(
    signer: GitSigner,
    hint: string,
    columns: string[],
    idColumn: string,
    options?: { writers?: string[] },
  ): Promise<string | null>;

  /** Append a row (JSON string) to the table at `hint`. Returns the tx id. */
  writeRow(signer: GitSigner, hint: string, rowJson: string): Promise<string>;

  // ---- table identity ----

  tableExists(hint: string): Promise<boolean>;

  /** Resolve a hint to an opaque `TableRef` (Solana PDA / EVM coordinates). */
  tableRef(hint: string): TableRef;

  /** Gateway routing key for a hint — Solana PDA base58, EVM table name. Used
   *  by the notify path so gateways can hydrate their cache on write. */
  tableKey(hint: string): string;
}

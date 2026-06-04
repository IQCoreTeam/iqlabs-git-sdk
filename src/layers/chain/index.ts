// L1 — chain selector. Holds the active adapter and re-exports its `ChainOps`
// as flat functions so L2/L3 keep calling `chain.codeIn(...)`,
// `chain.writeRow(...)`, etc. without knowing which chain backs them.
//
// Default is Solana — byte-identical to the pre-port behaviour. `setChain`
// flips the active adapter; `initChain` wires that adapter's runtime. Both
// adapters are statically imported, but neither touches the network at import
// (their `init()` is the only wiring point), so selecting one never trips the
// other's RPC.

import { solanaAdapter } from "./solana";
import { ethAdapter } from "./eth";
import type {
  ChainConfig,
  ChainOps,
  GitSigner,
  ReadOptions,
  Row,
  SessionSpeed,
  TableRef,
} from "./types";

export type {
  ChainConfig,
  ChainOps,
  EthNetwork,
  GitSigner,
  ReadOptions,
  Row,
  SessionSpeed,
  TableRef,
} from "./types";

export type ChainKind = "solana" | "eth";

let active: ChainOps = solanaAdapter;

/** Select the active chain adapter. Pure — does not touch the network. */
export function setChain(kind: ChainKind): void {
  active = kind === "eth" ? ethAdapter : solanaAdapter;
}

/** Wire the active adapter's runtime (connection / network). */
export function initChain(cfg: ChainConfig): void {
  active.init(cfg);
}

/** The active adapter's kind — for callers that need to branch on it. */
export function activeChain(): ChainKind {
  return active.kind;
}

// ---- ChainOps re-exported as flat functions bound to the active adapter ----

export function codeIn(
  signer: GitSigner,
  data: string | string[],
  filename: string,
  filetype: string,
  onProgress?: (percent: number) => void,
  speed?: SessionSpeed,
): Promise<string> {
  return active.codeIn(signer, data, filename, filetype, onProgress, speed);
}

export function readCodeIn(
  txId: string,
): Promise<{ data: string | null; metadata: string }> {
  return active.readCodeIn(txId);
}

export function readRows(hint: string, options?: ReadOptions): Promise<Row[]> {
  return active.readRows(hint, options);
}

export function readRowsByRef(ref: TableRef, options?: ReadOptions): Promise<Row[]> {
  return active.readRowsByRef(ref, options);
}

export function readLatestRow(hint: string): Promise<Row | null> {
  return active.readLatestRow(hint);
}

export function ensureDbRoot(signer: GitSigner): Promise<string | null> {
  return active.ensureDbRoot(signer);
}

export function createTable(
  signer: GitSigner,
  hint: string,
  columns: string[],
  idColumn: string,
  options?: { writers?: string[] },
): Promise<string | null> {
  return active.createTable(signer, hint, columns, idColumn, options);
}

export function writeRow(signer: GitSigner, hint: string, rowJson: string): Promise<string> {
  return active.writeRow(signer, hint, rowJson);
}

export function tableExists(hint: string): Promise<boolean> {
  return active.tableExists(hint);
}

export function tableRef(hint: string): TableRef {
  return active.tableRef(hint);
}

export function tableKey(hint: string): string {
  return active.tableKey(hint);
}

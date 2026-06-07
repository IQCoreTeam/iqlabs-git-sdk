// L1 — lazy front for the EVM adapter. Keeps `@iqlabs-official/ethereum-sdk`
// (and ethers) out of the import graph until an EVM op actually runs, so a
// Solana-only consumer can install the git-SDK without those optional peer
// deps. The real adapter lives in `./eth`; it's pulled in via a dynamic
// `import()` (a separate bundle chunk) on first async use.
//
// Sync methods (`tableRef`, `tableKey`) and gateway wiring need no ethereum-sdk
// and run without loading the real adapter — so `setNetwork('eth')` routes
// gateway reads correctly even before the first on-chain call.

import { IQGIT_ROOT_ID } from "../../core/seed";
import { setEthGatewayNetwork } from "../gateway";
import type {
  ChainConfig,
  ChainOps,
  GitSigner,
  ReadOptions,
  Row,
  SessionSpeed,
  TableRef,
} from "./types";

let real: ChainOps | null = null;
let pending: ChainConfig | null = null;

async function load(): Promise<ChainOps> {
  if (!real) {
    real = (await import("./eth")).ethAdapter;
    if (pending) real.init(pending);
  }
  return real;
}

export const ethAdapter: ChainOps = {
  kind: "eth",

  init(cfg: ChainConfig): void {
    pending = cfg;
    // Gateway routing needs no ethereum-sdk — wire it eagerly so reads route
    // to the right EVM network before the real adapter is loaded.
    if (cfg.chain === "eth") setEthGatewayNetwork(cfg.network);
    if (real) real.init(cfg);
  },

  async codeIn(
    signer: GitSigner,
    data: string | string[],
    filename: string,
    filetype: string,
    onProgress?: (percent: number) => void,
    speed?: SessionSpeed,
  ): Promise<string> {
    return (await load()).codeIn(signer, data, filename, filetype, onProgress, speed);
  },

  async readCodeIn(txId: string): Promise<{ data: string | null; metadata: string }> {
    return (await load()).readCodeIn(txId);
  },

  async readRows(hint: string, options?: ReadOptions): Promise<Row[]> {
    return (await load()).readRows(hint, options);
  },

  async readRowsByRef(ref: TableRef, options?: ReadOptions): Promise<Row[]> {
    return (await load()).readRowsByRef(ref, options);
  },

  async readLatestRow(hint: string): Promise<Row | null> {
    return (await load()).readLatestRow(hint);
  },

  async signerAddress(signer: GitSigner): Promise<string> {
    return (await load()).signerAddress(signer);
  },

  async ensureDbRoot(signer: GitSigner, dbRootId?: string): Promise<string | null> {
    return (await load()).ensureDbRoot(signer, dbRootId);
  },

  async createTable(
    signer: GitSigner,
    hint: string,
    columns: string[],
    idColumn: string,
    options?: { writers?: string[]; dbRootId?: string },
  ): Promise<string | null> {
    return (await load()).createTable(signer, hint, columns, idColumn, options);
  },

  async writeRow(
    signer: GitSigner,
    hint: string,
    rowJson: string,
    dbRootId?: string,
  ): Promise<string> {
    return (await load()).writeRow(signer, hint, rowJson, dbRootId);
  },

  async transferNative(
    signer: GitSigner,
    to: string,
    amount: number | bigint,
  ): Promise<string> {
    return (await load()).transferNative(signer, to, amount);
  },

  async tableExists(hint: string, dbRootId?: string): Promise<boolean> {
    return (await load()).tableExists(hint, dbRootId);
  },

  // Sync — same coordinates the real adapter returns, no ethereum-sdk needed.
  tableRef(hint: string, dbRootId = IQGIT_ROOT_ID): TableRef {
    return { dbRootId, tableName: hint };
  },

  tableKey(hint: string): string {
    return hint;
  },
};

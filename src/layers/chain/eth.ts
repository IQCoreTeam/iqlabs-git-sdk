// L1 — EVM adapter. Same `ChainOps` surface as the Solana adapter, backed by
// `@iqlabs-official/ethereum-sdk` (the 1:1 EVM port of solana-sdk) over ethers.
//
// Differences from the Solana path:
//  • The ethers `Signer` carries its own provider — no `Connection` to hold.
//  • Tables are addressed by `(dbRootId, tableName)`, so `tableRef` is a plain
//    object and there's no PDA derivation.
//  • No client-side chunk pacing: `codeIn` drops the `speed` arg.
//  • Reads go straight through the SDK reader for now; the multi-chain gateway
//    cache is wired in Phase 3.
//
// Import-safe: nothing here touches the network at module load — `init()` is
// the only place the active EVM network is selected.

import iqlabs from "@iqlabs-official/ethereum-sdk";
import type { Signer as EthSigner } from "ethers";
import { IQGIT_ROOT_ID } from "../../core/seed";
import {
  readCodeInViaGateway,
  readRowsByNameViaGateway,
  setEthGatewayNetwork,
} from "../gateway";
import type {
  ChainConfig,
  ChainOps,
  EthNetwork,
  GitSigner,
  ReadOptions,
  Row,
  TableRef,
} from "./types";

/** EVM `TableRef` — the coordinates the SDK reader/writer key off. */
interface EthTableRef {
  dbRootId: string;
  tableName: string;
}

// Active EVM network, set by init(). Reads pass it to the gateway and the
// gateway pins non-default chains (monad) with `?network=`.
let network: EthNetwork = "sepolia";

function asEth(signer: GitSigner): EthSigner {
  return signer as EthSigner;
}

// The SDK reader returns `{ txHash, data }[]` with `data` already JSON-parsed;
// the upper layers want just the row bodies.
function toRows(entries: Array<{ txHash: string; data: unknown }>): Row[] {
  return entries.map((e) => e.data as Row);
}

export const ethAdapter: ChainOps = {
  kind: "eth",

  init(cfg: ChainConfig): void {
    if (cfg.chain !== "eth") return;
    network = cfg.network;
    iqlabs.setNetwork(cfg.network, cfg.rpcUrl);
    setEthGatewayNetwork(cfg.network);
  },

  async codeIn(
    signer: GitSigner,
    data: string | string[],
    filename: string,
    filetype: string,
    onProgress?: (percent: number) => void,
  ): Promise<string> {
    return iqlabs.writer.codeIn(asEth(signer), data, filename, filetype, onProgress);
  },

  async readCodeIn(
    txHash: string,
  ): Promise<{ data: string | null; metadata: string }> {
    const viaGateway = await readCodeInViaGateway(txHash, network);
    if (viaGateway !== null) return viaGateway;
    const { data, metadata } = await iqlabs.reader.readCodeIn(txHash);
    return { data: data ?? null, metadata: JSON.stringify(metadata ?? {}) };
  },

  async readRows(hint: string, options?: ReadOptions): Promise<Row[]> {
    return this.readRowsByRef({ dbRootId: IQGIT_ROOT_ID, tableName: hint }, options);
  },

  async readRowsByRef(ref: TableRef, options?: ReadOptions): Promise<Row[]> {
    const { dbRootId, tableName } = ref as EthTableRef;
    const viaGateway = await readRowsByNameViaGateway(dbRootId, tableName, network, options);
    if (viaGateway !== null) return viaGateway;
    // EVM reader currently supports `limit` only; `before` is a no-op here.
    return toRows(await iqlabs.reader.readTableRows(dbRootId, tableName, { limit: options?.limit }));
  },

  async readLatestRow(hint: string): Promise<Row | null> {
    const rows = await this.readRows(hint, { limit: 1 });
    return rows[0] ?? null;
  },

  async signerAddress(signer: GitSigner): Promise<string> {
    return asEth(signer).getAddress();
  },

  async ensureDbRoot(signer: GitSigner): Promise<string | null> {
    // Idempotent at the SDK level — a revert (already initialized) maps to null.
    try {
      return await iqlabs.writer.initializeDbRoot(asEth(signer), IQGIT_ROOT_ID);
    } catch {
      return null;
    }
  },

  async createTable(
    signer: GitSigner,
    hint: string,
    columns: string[],
    idColumn: string,
    options?: { writers?: string[] },
  ): Promise<string | null> {
    // writers omitted ⇒ open table; array ⇒ restricted. isPrivate=false: git
    // tables are publicly readable. No gate / extKeys for the git namespace.
    return iqlabs.writer.createTable(
      asEth(signer),
      IQGIT_ROOT_ID,
      hint,
      columns,
      idColumn,
      [],
      undefined,
      options?.writers,
      false,
    );
  },

  async writeRow(signer: GitSigner, hint: string, rowJson: string): Promise<string> {
    return iqlabs.writer.writeRow(asEth(signer), IQGIT_ROOT_ID, hint, rowJson);
  },

  async tableExists(hint: string): Promise<boolean> {
    try {
      return (await iqlabs.reader.fetchTableMeta(IQGIT_ROOT_ID, hint)) != null;
    } catch {
      return false;
    }
  },

  tableRef(hint: string): TableRef {
    return { dbRootId: IQGIT_ROOT_ID, tableName: hint } satisfies EthTableRef;
  },

  tableKey(hint: string): string {
    // Multi-chain gateway routes EVM table reads by table name (Phase 3).
    return hint;
  },
};

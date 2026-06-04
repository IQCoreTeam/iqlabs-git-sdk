// L1 — Solana adapter. The original `chain.ts` body, re-shaped as a `ChainOps`
// implementation: PDA derivation stays hidden behind hints, reads prefer the
// iq-gateway HTTP cache then fall back to direct RPC, and the createTable /
// writeRow / ensureDbRoot calls that commit/repo used to import straight from
// `solana-sdk/writer` now live here behind the seam.
//
// The `Connection` is held in module state, wired once by `init()` — no caller
// above L1 threads a connection anymore.

import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import {
  createInstructionBuilder,
  getDbRootPda,
  getTablePda,
  initializeDbRootInstruction,
} from "@iqlabs-official/solana-sdk/contract";
import {
  readCodeIn as sdkReadCodeIn,
  readTableRows,
} from "@iqlabs-official/solana-sdk/reader";
import {
  toSeedBytes,
  type SignerInput,
  type WalletSigner,
} from "@iqlabs-official/solana-sdk/utils";
import {
  codeIn as sdkCodeIn,
  createTable as sdkCreateTable,
  writeRow as sdkWriteRow,
} from "@iqlabs-official/solana-sdk/writer";
import { IQGIT_ROOT_ID } from "../../core/seed";
import { readCodeInViaGateway, readRowsViaGateway } from "../gateway";
import type {
  ChainConfig,
  ChainOps,
  GitSigner,
  ReadOptions,
  Row,
  SessionSpeed,
  TableRef,
} from "./types";

/** DbRoot PDA for the `iq-git-v1` namespace — derived once, reused everywhere. */
const DB_ROOT_SEED = toSeedBytes(IQGIT_ROOT_ID);
const DB_ROOT = getDbRootPda(DB_ROOT_SEED);

// Wired by init(). Reads use a process-global RPC (setRpcUrl) like before;
// writes need the actual Connection the caller configured.
let connection: Connection | null = null;

function conn(): Connection {
  if (!connection) {
    throw new Error("solana adapter not initialized — call init({ chain: 'solana', connection })");
  }
  return connection;
}

// Narrow the chain-neutral signer union back to a Solana SignerInput.
function asSolana(signer: GitSigner): SignerInput {
  return signer as SignerInput;
}

// Sign a single Transaction with whatever shape the signer takes. Keypair has
// a `secretKey`; wallet adapters expose `signTransaction`. Mirrors solana-sdk's
// own sendTx dispatch so this helper stays self-contained.
async function signTx(signer: SignerInput, tx: Transaction): Promise<Transaction> {
  if (signer instanceof Keypair || "secretKey" in signer) {
    tx.partialSign(signer as Keypair);
    return tx;
  }
  return (signer as WalletSigner).signTransaction(tx);
}

function tablePda(hint: string): PublicKey {
  return getTablePda(DB_ROOT, toSeedBytes(hint));
}

async function accountExists(pda: PublicKey): Promise<boolean> {
  return (await conn().getAccountInfo(pda)) !== null;
}

async function readRowsByPda(
  pda: PublicKey,
  options?: ReadOptions,
): Promise<Row[]> {
  const viaGateway = await readRowsViaGateway(pda.toBase58(), options);
  if (viaGateway !== null) return viaGateway;
  return readTableRows(pda, options);
}

export const solanaAdapter: ChainOps = {
  kind: "solana",

  init(cfg: ChainConfig): void {
    if (cfg.chain !== "solana") return;
    connection = cfg.connection;
  },

  async codeIn(
    signer: GitSigner,
    data: string | string[],
    filename: string,
    filetype: string,
    onProgress?: (percent: number) => void,
    speed: SessionSpeed = "light",
  ): Promise<string> {
    // "light" is the Helius-friendly default for bursty per-file git uploads.
    return sdkCodeIn(
      { connection: conn(), signer: asSolana(signer) },
      data,
      filename,
      0,
      filetype,
      onProgress,
      speed,
    );
  },

  async readCodeIn(
    txSig: string,
  ): Promise<{ data: string | null; metadata: string }> {
    const viaGateway = await readCodeInViaGateway(txSig);
    if (viaGateway !== null) return viaGateway;
    return sdkReadCodeIn(txSig);
  },

  async readRows(hint: string, options?: ReadOptions): Promise<Row[]> {
    return readRowsByPda(tablePda(hint), options);
  },

  async readRowsByRef(ref: TableRef, options?: ReadOptions): Promise<Row[]> {
    return readRowsByPda(ref as PublicKey, options);
  },

  async readLatestRow(hint: string): Promise<Row | null> {
    const rows = await this.readRows(hint, { limit: 1 });
    return rows[0] ?? null;
  },

  async ensureDbRoot(signer: GitSigner): Promise<string | null> {
    const s = asSolana(signer);
    if (await accountExists(DB_ROOT)) return null;
    const builder = createInstructionBuilder();
    const ix = initializeDbRootInstruction(
      builder,
      {
        db_root: DB_ROOT,
        signer: s.publicKey,
        system_program: SystemProgram.programId,
      },
      { db_root_id: DB_ROOT_SEED },
    );
    const tx = new Transaction().add(ix);
    const c = conn();
    const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = s.publicKey;
    const signed = await signTx(s, tx);
    const signature = await c.sendRawTransaction(signed.serialize());
    await c.confirmTransaction({ signature, blockhash, lastValidBlockHeight });
    return signature;
  },

  async createTable(
    signer: GitSigner,
    hint: string,
    columns: string[],
    idColumn: string,
    options?: { writers?: string[] },
  ): Promise<string | null> {
    const s = asSolana(signer);
    // writers omitted ⇒ open table (registry); array ⇒ restricted writers.
    const writers = options?.writers?.map((w) => new PublicKey(w));
    return sdkCreateTable(
      conn(),
      s,
      IQGIT_ROOT_ID,
      hint,
      hint,
      columns,
      idColumn,
      [],
      undefined,
      writers,
      hint,
    );
  },

  async writeRow(signer: GitSigner, hint: string, rowJson: string): Promise<string> {
    return sdkWriteRow(conn(), asSolana(signer), IQGIT_ROOT_ID, hint, rowJson);
  },

  async tableExists(hint: string): Promise<boolean> {
    return accountExists(tablePda(hint));
  },

  tableRef(hint: string): TableRef {
    return tablePda(hint);
  },

  tableKey(hint: string): string {
    return tablePda(hint).toBase58();
  },
};

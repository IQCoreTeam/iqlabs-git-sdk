// L1 — chain primitives shared by L2/L3. Kept tiny by design: each function
// here either (a) hides PDA derivation so callers only deal with hints, or
// (b) wraps a single iqlabs-sdk call to keep an iq-git-specific default
// (chunk speed, root id, ...). Pure passthroughs like `createTable` /
// `writeRow` live at the call site instead — wrapping them once more would
// just bury the iqlabs-sdk surface (CODE-RULES §1).
//
// Read primitives transparently prefer the iq-gateway HTTP API and fall
// back to direct RPC; the gateway dispatch lives here so commit/repo/
// storage all benefit without each having to wire it up.

import {
  Keypair,
  SystemProgram,
  Transaction,
  type Connection,
  type PublicKey,
} from "@solana/web3.js";
import {
  createInstructionBuilder,
  getDbRootPda,
  getTablePda,
  initializeDbRootInstruction,
} from "@iqlabs-official/solana-sdk/contract";
import { readCodeIn as sdkReadCodeIn, readTableRows } from "@iqlabs-official/solana-sdk/reader";
import { toSeedBytes, type SignerInput, type WalletSigner } from "@iqlabs-official/solana-sdk/utils";
import { codeIn as sdkCodeIn } from "@iqlabs-official/solana-sdk/writer";
import { IQGIT_ROOT_ID } from "../core/seed";
import { readCodeInViaGateway, readRowsViaGateway } from "./gateway";

/** DbRoot PDA for the `iq-git-v1` namespace — derived once, reused everywhere. */
export const DB_ROOT_SEED = toSeedBytes(IQGIT_ROOT_ID);
export const DB_ROOT = getDbRootPda(DB_ROOT_SEED);

/**
 * Initialize the `iq-git-v1` DbRoot account if it doesn't exist. First-call
 * cost on a fresh network. Idempotent: returns null if already initialized.
 * Accepts any SignerInput so an admin can run it from a wallet, not just
 * from a Keypair.
 */
export async function ensureDbRoot(
  connection: Connection,
  signer: SignerInput,
): Promise<string | null> {
  if (await accountExists(connection, DB_ROOT)) return null;
  const builder = createInstructionBuilder();
  const ix = initializeDbRootInstruction(
    builder,
    {
      db_root: DB_ROOT,
      signer: signer.publicKey,
      system_program: SystemProgram.programId,
    },
    { db_root_id: DB_ROOT_SEED },
  );
  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = signer.publicKey;
  const signed = await signTx(signer, tx);
  const signature = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight });
  return signature;
}

// Sign a single Transaction with whatever shape the signer takes. Keypair
// has a `secretKey`; wallet adapters expose `signTransaction`. iqlabs-sdk's
// own `sendTx` uses the same dispatch; we replicate it here so the helper
// stays self-contained.
async function signTx(signer: SignerInput, tx: Transaction): Promise<Transaction> {
  if (signer instanceof Keypair || "secretKey" in signer) {
    tx.partialSign(signer as Keypair);
    return tx;
  }
  return (signer as WalletSigner).signTransaction(tx);
}

/**
 * Read rows from a table. Tries the iq-gateway HTTP cache first and falls
 * back to `iqlabs.reader.readTableRows` on miss. Callers see a uniform API
 * either way.
 */
export async function readRows(
  hint: string,
  options?: { limit?: number; before?: string },
): Promise<Array<Record<string, unknown>>> {
  return readRowsByPda(tablePda(hint), options);
}

/**
 * Same as readRows but keyed by the table PDA directly — for callers that
 * already have the PDA (e.g. a .sol record pointing at a commit table) and
 * can't or shouldn't re-derive it from a hint.
 */
export async function readRowsByPda(
  pda: PublicKey,
  options?: { limit?: number; before?: string },
): Promise<Array<Record<string, unknown>>> {
  const viaGateway = await readRowsViaGateway(pda.toBase58(), options);
  if (viaGateway !== null) return viaGateway;
  return readTableRows(pda, options);
}

/**
 * Fetch just the latest row of a table — the fast path for "what is the
 * current commit" and "what is the pinned deploy".
 */
export async function readLatestRow(
  hint: string,
): Promise<Record<string, unknown> | null> {
  const rows = await readRows(hint, { limit: 1 });
  return rows[0] ?? null;
}

/**
 * Speed presets forwarded to `iqlabs.writer.codeIn`. Matches the solana-sdk
 * `SESSION_SPEED_PROFILES` keys, re-exported here as `SessionSpeed` so
 * consumers don't have to import both SDKs to pick a value.
 */
export type SessionSpeed = "light" | "medium" | "heavy" | "extreme";

/**
 * Upload a blob via `iqlabs.writer.codeIn`. The SDK chunks internally when
 * `data` is a plain string. We default speed to "light" because that's the
 * Helius-friendly setting for git workloads (per-file uploads are bursty).
 */
export async function codeIn(
  connection: Connection,
  signer: SignerInput,
  data: string | string[],
  filename: string,
  filetype: string,
  onProgress?: (percent: number) => void,
  speed: SessionSpeed = "light",
): Promise<string> {
  return sdkCodeIn(
    { connection, signer },
    data,
    filename,
    0,
    filetype,
    onProgress,
    speed,
  );
}

/**
 * Read a codeIn payload by tx signature. Tries the gateway /data/:sig
 * cache first and falls back to the SDK's direct RPC decode.
 */
export async function readCodeIn(
  txSig: string,
): Promise<{ data: string | null; metadata: string }> {
  const viaGateway = await readCodeInViaGateway(txSig);
  if (viaGateway !== null) return viaGateway;
  return sdkReadCodeIn(txSig);
}

/** Cheap existence check for a PDA. */
export async function accountExists(
  connection: Connection,
  pda: PublicKey,
): Promise<boolean> {
  return (await connection.getAccountInfo(pda)) !== null;
}

/** Resolve a hint to its PDA. */
export function tablePda(hint: string): PublicKey {
  return getTablePda(DB_ROOT, toSeedBytes(hint));
}

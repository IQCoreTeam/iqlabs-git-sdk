// L1 — chain primitives shared by L2/L3. Kept tiny by design: each function
// here either (a) hides PDA derivation so callers only deal with hints, or
// (b) wraps a single iqlabs-sdk call to keep an iq-git-specific default
// (chunk speed, root id, ...). Pure passthroughs like `createTable` /
// `writeRow` live at the call site instead — wrapping them once more would
// just bury the iqlabs-sdk surface (CODE-RULES §1).

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
import { readCodeIn, readTableRows } from "@iqlabs-official/solana-sdk/reader";
import { toSeedBytes, type SignerInput, type WalletSigner } from "@iqlabs-official/solana-sdk/utils";
import { codeIn as sdkCodeIn } from "@iqlabs-official/solana-sdk/writer";
import { IQGIT_ROOT_ID } from "../core/seed";

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
 * Read rows from a table. Translates our hint into the PDA and forwards to
 * `iqlabs.reader.readTableRows`.
 */
export async function readRows(
  hint: string,
  options?: { limit?: number; before?: string },
): Promise<Array<Record<string, unknown>>> {
  return readTableRows(tablePda(hint), options);
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
  speed: "light" | "medium" | "fast" = "light",
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

export { readCodeIn };

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

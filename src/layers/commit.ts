// L3 — per-repo commit table.
//
// v2's core invariant: each repo has its own table at hint
// `git_commits:<owner>:<repo>`, with writers locked to [owner]. That means
// "the most recent successful tx in this table = the latest commit", and we
// read it as a single-row query (limit: 1).

import type { Connection, PublicKey } from "@solana/web3.js";
import { type SignerInput } from "@iqlabs-official/solana-sdk/utils";
import { createTable, writeRow } from "@iqlabs-official/solana-sdk/writer";
import { IQGIT_ROOT_ID, commitTableHint } from "../core/seed";
import type { Commit } from "../core/types";
import * as chain from "./chain";
import { notifyGateways } from "./gateway";

const COMMIT_COLUMNS = [
  "id",
  "message",
  "treeTxId",
  "parentCommitId",
  "timestamp",
  "author",
];

/**
 * Ensure the per-repo commit table exists with writers = [owner]. No-op if
 * it already exists.
 */
export async function ensureCommitTable(
  connection: Connection,
  signer: SignerInput,
  repo: string,
): Promise<string | null> {
  const hint = commitTableHint(signer.publicKey.toBase58(), repo);
  if (await chain.accountExists(connection, chain.tablePda(hint))) return null;
  return createTable(
    connection,
    signer,
    IQGIT_ROOT_ID,
    hint,
    hint,
    COMMIT_COLUMNS,
    "id",
    [],
    undefined,
    [signer.publicKey],
    hint,
  );
}

/**
 * Append one commit row. Callers (workflow-level code) are responsible for
 * setting parentCommitId — the SDK does not auto-chain.
 *
 * After the row lands on-chain, fires a best-effort /notify so any
 * iq-gateway already caching this table prepends the new commit without
 * waiting for RPC sig indexing.
 */
export async function writeCommit(
  connection: Connection,
  signer: SignerInput,
  repo: string,
  commit: Commit,
): Promise<string> {
  const owner = signer.publicKey.toBase58();
  const hint = commitTableHint(owner, repo);
  const sig = await writeRow(
    connection,
    signer,
    IQGIT_ROOT_ID,
    hint,
    JSON.stringify(commit),
  );
  notifyGateways(chain.tablePda(hint).toBase58(), sig, commit, owner);
  return sig;
}

/** The commit-table PDA for a repo. The one place owner/repo collapses to a
 *  PDA — every read keys off the PDA, so callers that have a PDA already (a
 *  .sol record, a dbroot match) skip this and pass it straight in. */
export function commitTablePda(owner: string, repo: string): PublicKey {
  return chain.tablePda(commitTableHint(owner, repo));
}

/** Latest commit. Single-row, O(1) RPC path. */
export async function readLatestCommit(pda: PublicKey): Promise<Commit | null> {
  const rows = await chain.readRowsByPda(pda, { limit: 1 });
  return (rows[0] as unknown as Commit) ?? null;
}

/** Full commit history, newest first. */
export async function readCommitHistory(
  pda: PublicKey,
  options?: { limit?: number; before?: string },
): Promise<Commit[]> {
  const rows = await chain.readRowsByPda(pda, options);
  return rows as unknown as Commit[];
}

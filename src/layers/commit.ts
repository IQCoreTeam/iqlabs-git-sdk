// L3 — per-repo commit table.
//
// v2's core invariant: each repo has its own table at hint
// `git_commits:<owner>:<repo>`, with writers locked to [owner]. That means
// "the most recent successful tx in this table = the latest commit", and we
// read it as a single-row query (limit: 1).

import type { Connection } from "@solana/web3.js";
import { type SignerInput } from "@iqlabs-official/solana-sdk/utils";
import { createTable, writeRow } from "@iqlabs-official/solana-sdk/writer";
import { IQGIT_ROOT_ID, commitTableHint } from "../core/seed";
import type { Commit } from "../core/types";
import * as chain from "./chain";

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
    signer as never,
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
 */
export async function writeCommit(
  connection: Connection,
  signer: SignerInput,
  repo: string,
  commit: Commit,
): Promise<string> {
  const owner = signer.publicKey.toBase58();
  return writeRow(
    connection,
    signer,
    IQGIT_ROOT_ID,
    commitTableHint(owner, repo),
    JSON.stringify(commit),
  );
}

/** Latest commit. Single-row, O(1) RPC path. */
export async function readLatestCommit(
  _connection: Connection,
  owner: string,
  repo: string,
): Promise<Commit | null> {
  const row = await chain.readLatestRow(commitTableHint(owner, repo));
  return row as unknown as Commit | null;
}

/** Full commit history, newest first. */
export async function readCommitHistory(
  _connection: Connection,
  owner: string,
  repo: string,
  options?: { limit?: number; before?: string },
): Promise<Commit[]> {
  const rows = await chain.readRows(commitTableHint(owner, repo), options);
  return rows as unknown as Commit[];
}

// L3 — per-repo commit table.
//
// v2's core invariant: each repo has its own table at hint
// `git_commits:<owner>:<repo>`, with writers locked to [owner]. That means
// "the most recent successful tx in this table = the latest commit", and we
// read it as a single-row query (limit: 1).

import { commitTableHint } from "../core/seed";
import type { Commit } from "../core/types";
import * as chain from "./chain";
import type { GitSigner, TableRef } from "./chain";
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
  signer: GitSigner,
  repo: string,
): Promise<string | null> {
  await chain.ensureDbRoot(signer);
  const owner = await chain.signerAddress(signer);
  const hint = commitTableHint(owner, repo);
  if (await chain.tableExists(hint)) return null;
  return chain.createTable(signer, hint, COMMIT_COLUMNS, "id", { writers: [owner] });
}

/**
 * Append one commit row. Callers (workflow-level code) are responsible for
 * setting parentCommitId — the SDK does not auto-chain.
 *
 * After the row lands on-chain, awaits a best-effort /notify so any
 * iq-gateway already caching this table prepends the new commit without
 * waiting for RPC sig indexing. Awaited (not fire-and-forget) so a short-lived
 * caller like the CLI can't exit before the notify goes out — otherwise the
 * gateway keeps serving a stale head page until its TTL lapses.
 */
export async function writeCommit(
  signer: GitSigner,
  repo: string,
  commit: Commit,
): Promise<string> {
  const owner = await chain.signerAddress(signer);
  const hint = commitTableHint(owner, repo);
  const sig = await chain.writeRow(signer, hint, JSON.stringify(commit));
  await notifyGateways(chain.tableKey(hint), sig, commit, owner);
  return sig;
}

/** The commit-table reference for a repo. The one place owner/repo collapses
 *  to a chain handle — every read keys off it, so callers that already have a
 *  ref (a .sol record, a dbroot match) skip this and pass it straight in. */
export function commitTableRef(owner: string, repo: string): TableRef {
  return chain.tableRef(commitTableHint(owner, repo));
}

/** Latest commit. Single-row, O(1) read path. */
export async function readLatestCommit(ref: TableRef): Promise<Commit | null> {
  const rows = await chain.readRowsByRef(ref, { limit: 1 });
  return (rows[0] as unknown as Commit) ?? null;
}

/** Full commit history, newest first. */
export async function readCommitHistory(
  ref: TableRef,
  options?: { limit?: number; before?: string },
): Promise<Commit[]> {
  const rows = await chain.readRowsByRef(ref, options);
  return rows as unknown as Commit[];
}

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
import { bustTableCache, notifyGateways } from "./gateway";

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
 * After the row lands on-chain we refresh every gateway's cache for this table,
 * awaited so a short-lived caller (the CLI) can't exit first:
 *   - notify injects the new row into the head-page cache (limits 5/10/20/50/100).
 *   - bust forces a ?fresh re-seed. This is what makes a re-commit visible to
 *     browser.iqlabs.dev: the site resolver reads `limit=1` for the latest
 *     treeTxId, and notify's prepend does NOT cover limit=1, so without the bust
 *     the resolver keeps seeing the OLD treeTxId (and renders the old site) until
 *     the 60s TTL lapses. Everything else in the render path is keyed by the new
 *     immutable treeTxId, so this one table is the only stale point.
 */

// The wide-web site resolver scans the commit table's newest rows to find the
// latest one signed by the repo owner, reading `?limit=20` (its COMMIT_SCAN_LIMIT
// in iq-wide-web/src/lib/iqpages/latest-commit.ts). The gateway keys its row
// cache per (pda, limit), so we must re-seed THAT limit for a re-commit to show
// up. Keep these two in sync. Exported so the pages layer re-seeds the same key.
export const SITE_RESOLVER_SCAN_LIMIT = 20;

export async function writeCommit(
  signer: GitSigner,
  repo: string,
  commit: Commit,
): Promise<string> {
  const owner = await chain.signerAddress(signer);
  const hint = commitTableHint(owner, repo);
  const tableKey = chain.tableKey(hint);
  const sig = await chain.writeRow(signer, hint, JSON.stringify(commit));
  await notifyGateways(tableKey, sig, commit, owner);
  // Re-seed the exact limit the wide-web site resolver reads (20). notify's
  // prepend does cover limit=20, but only when a head entry already exists; the
  // bust guarantees a re-commit is visible even on a cold/expired cache. Targets
  // just this one (pda, limit) rather than blanket-clearing the table. (manifest
  // + file blobs are keyed by the new immutable treeTxId and cache-miss into a
  // fresh read on their own — nothing to bust there.)
  await bustTableCache(tableKey, SITE_RESOLVER_SCAN_LIMIT);
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

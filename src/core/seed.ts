// The single source of truth for table_hint strings.
//
// Readers re-derive PDAs with `iqlabs.utils.toSeedBytes(hint)` →
// `iqlabs.contract.getTablePda(...)`; writers pass the same hint into
// `iqlabs.writer.createTable`. Keeping the naming convention in one place
// prevents silent drift between writer and reader. CODE-RULES §2 — if any
// caller ever wants to build one of these strings inline, route it here
// instead.

/** DbRoot id for every iq-git table. Bootstrap and every caller share this. */
export const IQGIT_ROOT_ID = "iq-git-v1";

/** `git_repos:all` — open-writers registry that drives the public gallery. */
export const REGISTRY_HINT = "git_repos:all";

/**
 * Hint for the per-owner personal repo list.
 * input:  owner wallet base58
 * output: "git_repos_v2_<owner>"
 */
export function repoListHint(owner: string): string {
  return `git_repos_v2_${owner}`;
}

/**
 * Hint for the per-repo commit table.
 * input:  owner wallet base58, repo name (any characters — SDK keccak-hashes)
 * output: "git_commits:<owner>:<repo>"
 */
export function commitTableHint(owner: string, repo: string): string {
  return `git_commits:${owner}:${repo}`;
}

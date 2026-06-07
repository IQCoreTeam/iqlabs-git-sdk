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

// === iq-pages ===
//
// Pages lives in its OWN DbRoot ("iqpages-root"), not the iq-git one — the
// gallery is a cross-owner registry with open writers, so it can't share
// `iq-git-v1`'s per-owner table layout. The pages layer passes IQPAGES_ROOT_ID
// to the chain seam (`chain.tableRef(hint, IQPAGES_ROOT_ID)`, etc.) rather than
// relying on the adapters' default iq-git root.

/** DbRoot id for the iq-pages deployment gallery. */
export const IQPAGES_ROOT_ID = "iqpages-root";

/** Single open-writers table that holds every deploy marker row. */
export const IQPAGES_DEPLOYED_HINT = "deployed";

/** One-time deploy fee on Solana, in lamports (0.2 SOL). */
export const PAGES_FEE_LAMPORTS = 200_000_000;

/** One-time deploy fee on EVM, in wei (0.01 ETH — value-matched to 0.2 SOL). */
export const PAGES_FEE_WEI = 10_000_000_000_000_000n;

/** Receiver of the Solana deploy fee. Same hard receiver the contract uses. */
export const PAGES_FEE_RECIPIENT = "EWNSTD8tikwqHMcRNuuNbZrnYJUiJdKq9UXLXSEU4wZ1";

/** Receiver of the EVM deploy fee — the same address the ethereum-sdk's
 *  on-chain `feeReceiver()` resolves to across sepolia / monad / monadTestnet
 *  (verified identical on all three). Pages fee is an app-layer transfer
 *  outside the contract, so we send it to the protocol's fee wallet directly. */
export const PAGES_FEE_RECIPIENT_EVM = "0xE94fA75aB69C18635A35556E9313e8D2aE009459";

/** Config / profile filenames a repo must commit to be deployable. */
export const IQPAGES_CONFIG_FILENAME = "iqpages.json";
export const IQPAGES_PROFILE_FILENAME = "iqprofile.json";

/**
 * Deploy-marker row id.
 * input:  owner wallet address, repo name
 * output: "<owner>:<repo>"
 */
export function pagesDeployId(owner: string, repo: string): string {
  return `${owner}:${repo}`;
}

// Domain types shared across every layer. Keep them inlined in call sites
// wherever possible (CODE-RULES §3) — this file only holds types that are
// actually reused by multiple modules.
//
// We do NOT re-declare a signer type. `SignerInput` from iqlabs-sdk already
// covers Node `Keypair`, web3.js `Signer`, and browser `WalletSigner`, so we
// just re-export it (CODE-RULES §1).

export type { SignerInput } from "@iqlabs-official/solana-sdk/utils";

/** Metadata row stored in `git_repos_v2_<owner>`. */
export interface Repository {
  name: string;
  description: string;
  isPublic: boolean;
  timestamp: number;
}

/** Commit row stored in `git_commits:<owner>:<repo>`. */
export interface Commit {
  id: string;
  message: string;
  treeTxId: string;
  parentCommitId?: string;
  timestamp: number;
  author: string;
}

/** Path → blob descriptor. This is the shape we serialize into tree.json. */
export type FileTree = Record<string, { txId: string; hash: string }>;

/** Row stored in the open `git_repos:all` registry. */
export interface RegistryEntry {
  owner: string;
  repo: string;
  description: string;
  timestamp: number;
}

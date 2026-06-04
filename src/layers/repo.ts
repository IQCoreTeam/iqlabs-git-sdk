// L3 — repo list and public registry.
//
// Covers the two "directory" tables:
//   • git_repos_v2_<owner>  — owner's personal repo list (writers = [owner])
//   • git_repos:all         — public gallery registry (writers = [])
//
// Commit tables are a separate concern — see `commit.ts`.

import { REGISTRY_HINT, repoListHint } from "../core/seed";
import type { RegistryEntry, Repository } from "../core/types";
import * as chain from "./chain";
import type { GitSigner } from "./chain";
import { notifyGateways } from "./gateway";

const REPO_COLUMNS = ["name", "description", "isPublic", "timestamp"];
const REGISTRY_COLUMNS = ["owner", "repo", "description", "timestamp"];

/**
 * Create a repo in the owner's personal list, and (if public) also register
 * it in the public gallery. Two transactions — the contract does not support
 * writing two tables atomically.
 *
 * Returns the writeRow tx signatures (and the table hint each one wrote to)
 * so a caller can notify gateways / build SSE streams for those tables. The
 * returned shape is `[]` from `createTable` calls because those don't write
 * a row, just allocate the account.
 */
export async function createRepo(
  signer: GitSigner,
  meta: Repository,
): Promise<Array<{ tableHint: string; sig: string; row: object }>> {
  const owner = await chain.signerAddress(signer);
  const listHint = repoListHint(owner);
  const writes: Array<{ tableHint: string; sig: string; row: object }> = [];

  if (!(await chain.tableExists(listHint))) {
    await chain.createTable(signer, listHint, REPO_COLUMNS, "name", { writers: [owner] });
  }

  const sig = await chain.writeRow(signer, listHint, JSON.stringify(meta));
  writes.push({ tableHint: listHint, sig, row: meta });
  notifyGateways(chain.tableKey(listHint), sig, meta, owner);

  if (meta.isPublic) {
    const entry: RegistryEntry = {
      owner,
      repo: meta.name,
      description: meta.description,
      timestamp: meta.timestamp,
    };
    const regSig = await chain.writeRow(signer, REGISTRY_HINT, JSON.stringify(entry));
    writes.push({ tableHint: REGISTRY_HINT, sig: regSig, row: entry });
    notifyGateways(chain.tableKey(REGISTRY_HINT), regSig, entry, owner);
  }

  return writes;
}

/** List all repos owned by `owner`. */
export async function readOwnerRepos(owner: string): Promise<Repository[]> {
  return (await chain.readRows(repoListHint(owner))) as unknown as Repository[];
}

/**
 * One page of the public-gallery registry. Callers should still check
 * `row.owner` shape before trusting it in UI; we do not filter at the SDK
 * boundary.
 */
export async function readRegistryPage(
  options?: { limit?: number; before?: string },
): Promise<RegistryEntry[]> {
  return (await chain.readRows(REGISTRY_HINT, options)) as unknown as RegistryEntry[];
}

/**
 * One-time global bootstrap of the `git_repos:all` table. Run once per
 * network from an admin key; subsequent calls short-circuit because the
 * account already exists.
 */
export async function bootstrapRegistry(signer: GitSigner): Promise<string | null> {
  await chain.ensureDbRoot(signer);
  if (await chain.tableExists(REGISTRY_HINT)) {
    return null;
  }
  // No `writers` ⇒ open table: anyone can register a public repo.
  return chain.createTable(signer, REGISTRY_HINT, REGISTRY_COLUMNS, "owner");
}

// L3 — repo list and public registry.
//
// Covers the two "directory" tables:
//   • git_repos_v2_<owner>  — owner's personal repo list (writers = [owner])
//   • git_repos:all         — public gallery registry (writers = [])
//
// Commit tables are a separate concern — see `commit.ts`.

import type { Connection } from "@solana/web3.js";
import { type SignerInput } from "@iqlabs-official/solana-sdk/utils";
import { createTable, writeRow } from "@iqlabs-official/solana-sdk/writer";
import { IQGIT_ROOT_ID, REGISTRY_HINT, repoListHint } from "../core/seed";
import type { RegistryEntry, Repository } from "../core/types";
import * as chain from "./chain";

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
  connection: Connection,
  signer: SignerInput,
  meta: Repository,
): Promise<Array<{ tableHint: string; sig: string; row: object }>> {
  const owner = signer.publicKey.toBase58();
  const listHint = repoListHint(owner);
  const writes: Array<{ tableHint: string; sig: string; row: object }> = [];

  if (!(await chain.accountExists(connection, chain.tablePda(listHint)))) {
    await createTable(
      connection,
      signer as never,
      IQGIT_ROOT_ID,
      listHint,
      listHint,
      REPO_COLUMNS,
      "name",
      [],
      undefined,
      [signer.publicKey],
      listHint,
    );
  }

  const sig = await writeRow(connection, signer, IQGIT_ROOT_ID, listHint, JSON.stringify(meta));
  writes.push({ tableHint: listHint, sig, row: meta });

  if (meta.isPublic) {
    const entry: RegistryEntry = {
      owner,
      repo: meta.name,
      description: meta.description,
      timestamp: meta.timestamp,
    };
    const regSig = await writeRow(connection, signer, IQGIT_ROOT_ID, REGISTRY_HINT, JSON.stringify(entry));
    writes.push({ tableHint: REGISTRY_HINT, sig: regSig, row: entry });
  }

  return writes;
}

/** List all repos owned by `owner`. */
export async function readOwnerRepos(
  _connection: Connection,
  owner: string,
): Promise<Repository[]> {
  return (await chain.readRows(repoListHint(owner))) as unknown as Repository[];
}

/**
 * One page of the public-gallery registry. Callers should still check
 * `row.owner` shape before trusting it in UI; we do not filter at the SDK
 * boundary.
 */
export async function readRegistryPage(
  _connection: Connection,
  options?: { limit?: number; before?: string },
): Promise<RegistryEntry[]> {
  return (await chain.readRows(REGISTRY_HINT, options)) as unknown as RegistryEntry[];
}

/**
 * One-time global bootstrap of the `git_repos:all` table. Run once per
 * network from an admin key; subsequent calls short-circuit because the
 * account already exists.
 */
export async function bootstrapRegistry(
  connection: Connection,
  signer: SignerInput,
): Promise<string | null> {
  await chain.ensureDbRoot(connection, signer);
  if (await chain.accountExists(connection, chain.tablePda(REGISTRY_HINT))) {
    return null;
  }
  return createTable(
    connection,
    signer as never,
    IQGIT_ROOT_ID,
    REGISTRY_HINT,
    REGISTRY_HINT,
    REGISTRY_COLUMNS,
    "owner",
    [],
    undefined,
    undefined,
    REGISTRY_HINT,
  );
}

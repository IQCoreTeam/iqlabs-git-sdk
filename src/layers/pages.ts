// L3 — iq-pages deployment gallery.
//
// A "deploy" is one marker row appended to a single open-writers table at
// `iqpages-root/deployed`:
//
//     { id: "<owner>:<repo>", owner, repo, deployedAt }
//
// The site's actual files are NOT snapshotted here — they're served live from
// the repo's latest git commit tree, so a re-commit updates the deployed site
// without re-deploying. This layer only owns the marker registry + the one-time
// deploy fee.
//
// Unlike repo.ts / commit.ts, pages lives in its OWN DbRoot ("iqpages-root").
// It still goes entirely through the chain seam — every read/write passes
// `IQPAGES_ROOT_ID` to `chain.*`, so the gallery works on Solana and EVM alike.
// The deploy fee is the one chain-specific bit: native SOL on Solana, native
// ETH on EVM, gated on `chain.activeChain()`.

import * as chain from "./chain";
import type { GitSigner, TableRef } from "./chain";
import {
  IQPAGES_CONFIG_FILENAME,
  IQPAGES_DEPLOYED_HINT,
  IQPAGES_PROFILE_FILENAME,
  IQPAGES_ROOT_ID,
  PAGES_FEE_LAMPORTS,
  PAGES_FEE_RECIPIENT,
  PAGES_FEE_RECIPIENT_EVM,
  PAGES_FEE_WEI,
  commitTableHint,
  pagesDeployId,
} from "../core/seed";
import type {
  PagesConfig,
  PagesDeployment,
  PagesProfile,
} from "../core/types";
import { commitTableRef, readLatestCommit } from "./commit";
import { bustTableCache, notifyGateways } from "./gateway";
import { loadBlob, loadTree } from "./storage";

const DEPLOYED_COLUMNS = ["id", "owner", "repo", "deployedAt"];

/** Ref to the single `iqpages-root/deployed` gallery table. Pages owns the
 *  (root, hint) identity; the active adapter resolves it (Solana PDA / EVM
 *  coordinates) — chain-neutral. */
export function pagesTableRef(): TableRef {
  return chain.tableRef(IQPAGES_DEPLOYED_HINT, IQPAGES_ROOT_ID);
}

/** Gateway routing key for the gallery table — for the notify call. */
function pagesTableKey(): string {
  return chain.tableKey(IQPAGES_DEPLOYED_HINT, IQPAGES_ROOT_ID);
}

/** Every deploy marker in the gallery. Gateway-first, RPC fallback (handled by
 *  the adapter). */
export async function listPagesDeployments(): Promise<PagesDeployment[]> {
  const rows = await chain.readRowsByRef(pagesTableRef());
  return rows as unknown as PagesDeployment[];
}

/** True if `<owner>/<repo>` already has a deploy marker. */
export async function isPagesDeployed(owner: string, repo: string): Promise<boolean> {
  const id = pagesDeployId(owner, repo);
  const all = await listPagesDeployments();
  return all.some((r) => r.id === id);
}

/** Read a JSON file from the repo's latest commit tree. Returns null when the
 *  repo has no commits or the file is absent — never throws on absence. */
async function readJsonFromLatest<T>(
  owner: string,
  repo: string,
  filename: string,
): Promise<T | null> {
  const latest = await readLatestCommit(commitTableRef(owner, repo));
  if (!latest) return null;
  const tree = await loadTree(latest.treeTxId);
  const entry = tree[filename];
  if (!entry?.txId) return null;
  const base64 = await loadBlob(entry.txId);
  return JSON.parse(Buffer.from(base64, "base64").toString("utf8")) as T;
}

/** `iqpages.json` from the repo's latest commit, or null if not committed. */
export async function readPagesConfig(
  owner: string,
  repo: string,
): Promise<PagesConfig | null> {
  return readJsonFromLatest<PagesConfig>(owner, repo, IQPAGES_CONFIG_FILENAME);
}

/** readPagesConfig against a guaranteed-fresh view. The repo's commit table
 *  may be cached at the gateway (a caller that just pushed iqpages.json in the
 *  same run would otherwise read a pre-push head), so bust that cache once —
 *  forcing a cold RPC read — then read. One shot: if the manifest still isn't
 *  there, it genuinely isn't committed yet, and deploy fails cleanly. */
async function readPagesConfigFresh(
  owner: string,
  repo: string,
): Promise<PagesConfig | null> {
  await bustTableCache(chain.tableKey(commitTableHint(owner, repo)));
  return readPagesConfig(owner, repo);
}

/** `iqprofile.json` from the repo's latest commit, or null if not committed. */
export async function readPagesProfile(
  owner: string,
  repo: string,
): Promise<PagesProfile | null> {
  return readJsonFromLatest<PagesProfile>(owner, repo, IQPAGES_PROFILE_FILENAME);
}

/** Ensure the iqpages DbRoot + the open-writers `deployed` table exist. The
 *  gallery is cross-owner, so the table takes no `writers` (anyone can append
 *  their own marker). Cheap no-op once both exist. */
async function ensureGallery(signer: GitSigner): Promise<void> {
  await chain.ensureDbRoot(signer, IQPAGES_ROOT_ID);
  if (await chain.tableExists(IQPAGES_DEPLOYED_HINT, IQPAGES_ROOT_ID)) return;
  await chain.createTable(signer, IQPAGES_DEPLOYED_HINT, DEPLOYED_COLUMNS, "id", {
    dbRootId: IQPAGES_ROOT_ID,
  });
}

/** Charge the one-time deploy fee in the active chain's native currency.
 *  Solana: 0.2 SOL → PAGES_FEE_RECIPIENT. EVM: 0.01 ETH → PAGES_FEE_RECIPIENT_EVM. */
async function chargeFee(signer: GitSigner): Promise<void> {
  if (chain.activeChain() === "eth") {
    await chain.transferNative(signer, PAGES_FEE_RECIPIENT_EVM, PAGES_FEE_WEI);
  } else {
    await chain.transferNative(signer, PAGES_FEE_RECIPIENT, PAGES_FEE_LAMPORTS);
  }
}

/**
 * Register `<owner>/<repo>` in the gallery and charge the one-time fee.
 *
 * Pre-flight (in order): not already deployed → `iqpages.json` is committed.
 * Then it ensures the gallery exists, writes the marker row, and transfers the
 * fee in a separate tx (the contract can't do both atomically).
 *
 * Returns the marker-row tx id plus the resolved config so callers can print
 * the live site URL without a second read.
 */
export async function deployPages(
  signer: GitSigner,
  repo: string,
): Promise<{ sig: string; config: PagesConfig }> {
  const owner = await chain.signerAddress(signer);

  if (await isPagesDeployed(owner, repo)) {
    throw new Error(`already deployed: ${owner}/${repo}`);
  }

  // Sanity-check the manifest before charging — keeps the gallery free of
  // broken links. Reads the repo's LATEST commit through a freshly-busted
  // cache: a caller (e.g. the CLI) that just pushed iqpages.json in the same
  // run would otherwise hit a pre-push cached head and get a misleading
  // "commit it first".
  const config = await readPagesConfigFresh(owner, repo);
  if (!config) {
    throw new Error(
      `${IQPAGES_CONFIG_FILENAME} missing in ${repo}. Commit it first, then deploy.`,
    );
  }

  await ensureGallery(signer);

  const row: PagesDeployment = {
    id: pagesDeployId(owner, repo),
    owner,
    repo,
    deployedAt: Date.now(),
  };
  const sig = await chain.writeRow(
    signer,
    IQPAGES_DEPLOYED_HINT,
    JSON.stringify(row),
    IQPAGES_ROOT_ID,
  );
  // Make the deploy visible to readers (browser.iqlabs.dev) immediately, with
  // no change needed on the read side. Two tables decide whether a site shows:
  // the gallery ("is this deployed?") and the repo's commit table ("what's the
  // latest treeTxId?"). For each we notify (optimistic row inject) AND fresh
  // (force the gateway to re-seed its cache from chain) so the next plain cached
  // read returns the new state regardless of RPC indexing lag or which gateway
  // the reader hits. Awaited so a short-lived CLI can't exit first.
  const galleryKey = pagesTableKey();
  const commitKey = chain.tableKey(commitTableHint(owner, repo));
  await notifyGateways(galleryKey, sig, row, owner);
  await Promise.allSettled([bustTableCache(galleryKey), bustTableCache(commitKey)]);

  await chargeFee(signer);

  return { sig, config };
}

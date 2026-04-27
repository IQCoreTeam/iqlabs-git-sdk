// L2 — blob + tree storage.
//
// `uploadBlob` is the file-level "don't re-upload what's already on-chain"
// primitive. Content is always a base64 string (matching iq-git v1) so the
// hash / dedup comparison stays byte-for-byte compatible across commits.
// The reuse-map is just a plain object so callers can build it any way they
// like (path→entry, or hash→txId for rename-aware dedup — CODE-RULES §3
// keeps this inlined at the call site instead of a new type).
//
// `uploadTree` / `loadTree` serialize FileTree <-> on-chain tree.json as raw
// JSON (filetype `application/json`), again matching v1.

import type { Connection } from "@solana/web3.js";
import type { SignerInput } from "@iqlabs-official/solana-sdk/utils";
import { sha256Hex } from "../core/hash";
import type { FileTree } from "../core/types";
import * as chain from "./chain";

/**
 * Upload one file unless an identical hash is already in `reuse` (blob dedup).
 *
 * input:  connection, signer, relativePath, base64 content, reuse map, optional onProgress
 * output: { txId, hash } — either reused or freshly uploaded
 */
export async function uploadBlob(
  connection: Connection,
  signer: SignerInput,
  relativePath: string,
  base64Content: string,
  reuse: FileTree,
  onProgress?: (percent: number) => void,
): Promise<{ txId: string; hash: string }> {
  const hash = await sha256Hex(base64Content);
  const prior = reuse[relativePath];
  if (prior && prior.hash === hash) return prior;

  // Tag the codeIn filename with our app marker so non-inline inventory
  // entries can be classified by inspecting metadata.filename alone (no row
  // body fetch needed). Format: "iqgit-blob:<basename>". Same scheme used
  // for trees ("iqgit-tree") and other writes across the IQ ecosystem.
  const basename = relativePath.split("/").pop() || relativePath;
  const txId = await chain.codeIn(
    connection,
    signer,
    base64Content,
    `iqgit-blob:${basename}`,
    "application/octet-stream",
    onProgress,
  );
  return { txId, hash };
}

/**
 * Serialize a FileTree and upload it as one `tree.json` blob.
 */
export async function uploadTree(
  connection: Connection,
  signer: SignerInput,
  tree: FileTree,
): Promise<string> {
  return chain.codeIn(
    connection,
    signer,
    JSON.stringify(tree),
    "iqgit-tree",
    "application/json",
  );
}

/**
 * Fetch and parse a `tree.json` blob by its tx signature.
 */
export async function loadTree(treeTxId: string): Promise<FileTree> {
  const { data } = await chain.readCodeIn(treeTxId);
  if (data === null) {
    throw new Error(`tree.json not found for tx ${treeTxId}`);
  }
  return JSON.parse(data) as FileTree;
}

/**
 * Retrieve a blob's bytes by its txId. Returns the raw string that was
 * uploaded — for blobs this is base64; the caller decodes.
 */
export async function loadBlob(txId: string): Promise<string> {
  const { data } = await chain.readCodeIn(txId);
  if (data === null) {
    throw new Error(`blob not found for tx ${txId}`);
  }
  return data;
}

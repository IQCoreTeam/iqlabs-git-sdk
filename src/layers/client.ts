// L4 — GitClient facade. High-level workflows built by composing the
// layers below. This is the surface consumers (CLI, frontend, migrator) use;
// they should not reach into `chain` / `storage` / `repo` / `commit` directly.
//
// Keep workflow logic here, not inside lower layers (CODE-RULES §5). When a
// command needs scanning, hashing, uploading, row writing — this file
// orchestrates them all.

import type { Connection } from "@solana/web3.js";
import { setRpcUrl } from "@iqlabs-official/solana-sdk";
import type { SignerInput } from "@iqlabs-official/solana-sdk/utils";
import { sha256Hex } from "../core/hash";
import { commitTableHint } from "../core/seed";
import type { Commit, FileTree, Repository } from "../core/types";
import * as chain from "./chain";
import * as commitLayer from "./commit";
import * as repoLayer from "./repo";
import * as storage from "./storage";

/** Information surfaced to the `onWrite` callback for every successful row
 *  write the SDK performs. Consumers wire this to their gateway notify so
 *  the gateway updates its cache / SSE stream immediately. */
export interface WriteEvent {
  /** Resolved table PDA, base58 — pass directly to gateway notify. */
  tablePda: string;
  /** The hint that derived the PDA, in case callers want to log it. */
  tableHint: string;
  /** writeRow tx signature. */
  sig: string;
  /** The row object that was written (already JSON.stringify-able). */
  row: object;
}

export interface GitClientConfig {
  connection: Connection;
  signer: SignerInput;
  /** Fires after each successful row write inside the SDK. Fire-and-forget
   *  callback for gateway notifies; throwing here will surface to the caller. */
  onWrite?: (event: WriteEvent) => void;
  /** Default solana-sdk session speed for blob / tree uploads (`"light"` is
   *  the per-operation default and works well on Helius free-tier RPCs).
   *  Override per call with `commit({ speed })`. See `SESSION_SPEED_PROFILES`. */
  speed?: chain.SessionSpeed;
}

export class GitClient {
  // CODE-RULES §3 — only one small shape; inlined rather than aliased.
  constructor(private readonly cfg: GitClientConfig) {
    // The solana-sdk reader path (readTableRows / readCodeIn → loadTree /
    // readLatestCommit) does not take a Connection — it resolves a
    // process-global one from env / setRpcUrl. Writes use `cfg.connection`,
    // so without this reads could hit a different RPC (e.g. the mainnet-beta
    // fallback when no env is set, as in a built browser bundle). Sync the
    // reader's RPC to the connection the caller actually gave us.
    setRpcUrl(cfg.connection.rpcEndpoint);
  }

  /**
   * Create a new repo. Wraps repo.createRepo + pre-creating the commit table
   * so the first `commit()` call doesn't need to pay createTable cost.
   */
  async createRepo(meta: Repository): Promise<void> {
    const { connection, signer } = this.cfg;
    const writes = await repoLayer.createRepo(connection, signer, meta);
    await commitLayer.ensureCommitTable(connection, signer, meta.name);
    this.fireOnWrite(writes);
  }

  /**
   * Incremental commit against a scanned directory snapshot.
   *
   * input:  repoName, message, scan — a `{ [path]: base64Content }` map that
   *         the caller produced (Node: fs walk + base64; browser: File input).
   * output: newly written Commit
   */
  async commit(
    repoName: string,
    message: string,
    scan: Record<string, string>,
    options?: { speed?: chain.SessionSpeed },
  ): Promise<Commit> {
    const { connection, signer } = this.cfg;
    const owner = signer.publicKey.toBase58();
    const speed = options?.speed ?? this.cfg.speed;

    const latest = await commitLayer.readLatestCommit(commitLayer.commitTablePda(owner, repoName));
    const oldTree: FileTree = latest ? await storage.loadTree(latest.treeTxId) : {};

    const newTree: FileTree = {};
    for (const [path, content] of Object.entries(scan)) {
      newTree[path] = await storage.uploadBlob(
        connection,
        signer,
        path,
        content,
        oldTree,
        undefined,
        speed,
      );
    }

    const treeTxId = await storage.uploadTree(connection, signer, newTree, speed);

    const commit: Commit = {
      id: crypto.randomUUID(),
      message,
      treeTxId,
      parentCommitId: latest?.id,
      timestamp: Date.now(),
      author: owner,
    };
    const sig = await commitLayer.writeCommit(connection, signer, repoName, commit);
    this.fireOnWrite([{ tableHint: commitTableHint(owner, repoName), sig, row: commit }]);
    return commit;
  }

  /** Resolve the table hint to a PDA and forward each write to `onWrite`.
   *  Wrapped in try/catch per call so a misbehaving notify can't fail the
   *  whole batch — but we still surface the error so the consumer knows. */
  private fireOnWrite(writes: Array<{ tableHint: string; sig: string; row: object }>) {
    if (!this.cfg.onWrite) return;
    for (const w of writes) {
      const tablePda = chain.tablePda(w.tableHint).toBase58();
      this.cfg.onWrite({ tablePda, tableHint: w.tableHint, sig: w.sig, row: w.row });
    }
  }

  /**
   * Restore a commit's files into a caller-provided sink. Runtime-neutral
   * shape mirrors `commit`: the caller decides how to write bytes to disk /
   * to a File System Access API handle / anywhere else. `content` is the
   * raw base64 string — the sink decodes.
   */
  async checkout(
    repoName: string,
    commitId: string | "latest",
    sink: (path: string, content: string) => Promise<void>,
  ): Promise<Commit> {
    const { connection, signer } = this.cfg;
    const owner = signer.publicKey.toBase58();

    const pda = commitLayer.commitTablePda(owner, repoName);
    let target: Commit | null;
    if (commitId === "latest") {
      target = await commitLayer.readLatestCommit(pda);
    } else {
      const history = await commitLayer.readCommitHistory(pda);
      target = history.find((c) => c.id === commitId) ?? null;
    }
    if (!target) {
      throw new Error(`commit not found: ${commitId} in ${owner}/${repoName}`);
    }

    const tree = await storage.loadTree(target.treeTxId);
    for (const [path, entry] of Object.entries(tree)) {
      const content = await storage.loadBlob(entry.txId);
      await sink(path, content);
    }
    return target;
  }

  /**
   * Whole-repo snapshot download — convenience on top of checkout("latest")
   * but reading from someone else's `owner`. We do not require signer to
   * equal owner for reads.
   */
  async clone(
    repoName: string,
    owner: string,
    sink: (path: string, content: string) => Promise<void>,
  ): Promise<Commit> {
    const target = await commitLayer.readLatestCommit(commitLayer.commitTablePda(owner, repoName));
    if (!target) {
      throw new Error(`no commits in ${owner}/${repoName}`);
    }
    const tree = await storage.loadTree(target.treeTxId);
    for (const [path, entry] of Object.entries(tree)) {
      const content = await storage.loadBlob(entry.txId);
      await sink(path, content);
    }
    return target;
  }

  /** Commit history for a repo. */
  async log(
    owner: string,
    repoName: string,
    options?: { limit?: number; before?: string },
  ): Promise<Commit[]> {
    return commitLayer.readCommitHistory(commitLayer.commitTablePda(owner, repoName), options);
  }

  /**
   * Compare a current directory snapshot to the latest commit's tree.
   */
  async status(
    owner: string,
    repoName: string,
    scan: Record<string, string>,
  ): Promise<{ added: string[]; modified: string[]; unchanged: string[] }> {
    const latest = await commitLayer.readLatestCommit(commitLayer.commitTablePda(owner, repoName));
    const tree: FileTree = latest ? await storage.loadTree(latest.treeTxId) : {};

    const added: string[] = [];
    const modified: string[] = [];
    const unchanged: string[] = [];
    for (const [path, content] of Object.entries(scan)) {
      const prior = tree[path];
      if (!prior) {
        added.push(path);
        continue;
      }
      const hash = await sha256Hex(content);
      (prior.hash === hash ? unchanged : modified).push(path);
    }
    return { added, modified, unchanged };
  }
}

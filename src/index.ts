// Shared entry — no runtime side-effects. Consumers that import from
// "@iqlabs-official/git-sdk" get types and pure functions only. Platform-specific apps
// should import from "@iqlabs-official/git-sdk/browser" or "@iqlabs-official/git-sdk/node" so the
// SHA-256 backend is installed.

export * from "./core/types";
export * from "./core/seed";

// The client and its layers are re-exported so apps can use them even
// without a platform entry (e.g. in tests that stub hash). If they try to
// actually compute hashes without a platform entry they'll get a clear
// "sha256 not installed" error from hash.ts.
export { GitClient } from "./layers/client";
export type { GitClientConfig, WriteEvent } from "./layers/client";
export { bootstrapRegistry, readOwnerRepos, readRegistryPage } from "./layers/repo";
export { readCommitHistory, readLatestCommit } from "./layers/commit";
export { loadBlob, loadTree } from "./layers/storage";

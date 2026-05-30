# @iqlabs-official/git-sdk

Embed on-chain Git into your Solana dApp. Browser SDK for letting users browse, create, and commit to repositories from your website, with a Node entry for tooling.

## Install

```bash
npm install @iqlabs-official/git-sdk
```

Peer deps: `@solana/web3.js`, `@iqlabs-official/solana-sdk` (aliased as `iqlabs-sdk`), `buffer`.

## Usage

### Browser (frontend / dApp)

```ts
import { GitClient, readRegistryPage } from "@iqlabs-official/git-sdk/browser";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

const { connection } = useConnection();
const wallet = useWallet();

// Read-only — no wallet required.
const entries = await readRegistryPage(connection, { limit: 50 });

// Write — needs a connected wallet adapter.
const client = new GitClient({
  connection,
  signer: {
    publicKey: wallet.publicKey!,
    signTransaction: wallet.signTransaction!,
    signAllTransactions: wallet.signAllTransactions!,
  },
});

await client.createRepo({
  name: "my-repo",
  description: "hello on-chain",
  isPublic: true,
  timestamp: Date.now(),
});
```

### Node (CLI / scripts)

```ts
import { GitClient } from "@iqlabs-official/git-sdk/node";
import { Connection, Keypair } from "@solana/web3.js";

const connection = new Connection(process.env.SOLANA_RPC_ENDPOINT!);
const signer = Keypair.fromSecretKey(/* your secret key */);
const client = new GitClient({ connection, signer });

await client.commit("my-repo", "initial", scan);
```

## API surface

- `GitClient` — high-level workflows: `createRepo`, `commit`, `checkout`, `clone`, `log`, `status`.
- `readOwnerRepos`, `readRegistryPage` — owner repo list + public gallery.
- `readLatestCommit`, `readCommitHistory` — direct commit-table reads.
- `loadTree`, `loadBlob` — pull a stored `tree.json` or file blob by tx signature.
- `bootstrapRegistry` — one-time admin call to initialize the global registry table on a fresh network.

`SignerInput` from `@iqlabs-official/solana-sdk` is accepted everywhere a signer is needed: a `Keypair`, a web3.js `Signer`, or a wallet adapter object with `signTransaction` / `signAllTransactions`.

## Tuning upload speed

Blob and tree uploads forward to `iqlabs.writer.codeIn`, which sets RPS and concurrency from a `SESSION_SPEED_PROFILES` preset. The git-sdk default is `"light"` (Helius free-tier friendly). You can either pick a preset or pass raw dials:

```ts
// 1. Pick a preset name.
const client = new GitClient({ connection, signer, speed: "heavy" });

// 2. Or override raw RPS / concurrency directly. Missing keys fall back
//    to the default preset values.
const client = new GitClient({
  connection,
  signer,
  speed: { maxRps: 80, maxConcurrencyUpload: 30 },
});

// Per-call override (wins over the client-level default):
await client.commit("my-repo", "tweak", scan, { speed: "extreme" });
await client.commit("my-repo", "tweak", scan, {
  speed: { maxRps: 120, maxConcurrencyUpload: 40 },
});
```

Available presets: `light` | `medium` | `heavy` | `extreme`. The raw object accepts `maxRps`, `maxConcurrency`, `maxConcurrencyUpload`. See the [solana-sdk docs](https://iqlabs.mintlify.app/docs-typescript#session-speed) for the preset values.

## Subpath entries

| Import | When to use |
|---|---|
| `@iqlabs-official/git-sdk` | Types and pure functions only. No SHA-256 backend installed. |
| `@iqlabs-official/git-sdk/browser` | Installs SubtleCrypto SHA-256. Use this in browser apps. |
| `@iqlabs-official/git-sdk/node` | Installs `node:crypto` SHA-256. Use this in CLI / server. |

Importing the appropriate platform entry exactly once is required before calling any function that hashes content (e.g. `commit`, `status`).

## License

MIT

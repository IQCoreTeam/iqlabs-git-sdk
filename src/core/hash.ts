// SHA-256 content hashing for the blob-dedup index. Runtime-specific
// implementations live in `platform/hash-node.ts` and `platform/hash-browser.ts`;
// this module just declares the interface the rest of the SDK uses.
//
// Do NOT use this for deriving table seeds — that path is owned by
// `iqlabs.utils.toSeedBytes` (keccak) and must stay aligned with the SDK.

/**
 * SHA-256 of a UTF-8 or base64 string, returned as a lowercase hex digest.
 * Implementation is injected by the platform entry (node.ts / browser.ts).
 */
export type Sha256Hex = (input: string) => Promise<string>;

// Platform entries (src/node.ts, src/browser.ts) will call `setSha256(...)`
// during module init so downstream layers never care which runtime they are in.
// This indirection is the one place where a wrapper is justified (CODE-RULES §1)
// because the behavior genuinely differs per runtime.
let impl: Sha256Hex | undefined;

export function setSha256(fn: Sha256Hex): void {
  if (impl) {
    throw new Error(
      "@iqlabs-official/git-sdk: sha256 implementation already installed. Import exactly one of '@iqlabs-official/git-sdk/node' or '@iqlabs-official/git-sdk/browser'.",
    );
  }
  impl = fn;
}

export async function sha256Hex(input: string): Promise<string> {
  if (!impl) {
    throw new Error(
      "@iqlabs-official/git-sdk: sha256 not installed. Import '@iqlabs-official/git-sdk/node' (Node) or '@iqlabs-official/git-sdk/browser' (browser) before using the SDK.",
    );
  }
  return impl(input);
}

// Browser SHA-256 implementation. Kept as a pure export; `src/browser.ts`
// installs it via `setSha256` during its own module init.

import type { Sha256Hex } from "../core/hash";

export const hashBrowser: Sha256Hex = async (input) => {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

// Browser entry. Installs the Web-Crypto SHA-256 hasher, then re-exports
// everything from the shared root.

import { setSha256 } from "./core/hash";
import { hashBrowser } from "./platform/hash-browser";

setSha256(hashBrowser);

export * from "./index";

// Node entry. Installs the node:crypto SHA-256 hasher, then re-exports
// everything from the shared root. CLI / migrator / test harnesses all go
// through here.

import { setSha256 } from "./core/hash";
import { hashNode } from "./platform/hash-node";

setSha256(hashNode);

export * from "./index";

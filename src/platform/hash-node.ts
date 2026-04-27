// Node SHA-256 implementation. Kept as a pure export; `src/node.ts` installs
// it via `setSha256` during its own module init.

import { createHash } from "node:crypto";
import type { Sha256Hex } from "../core/hash";

export const hashNode: Sha256Hex = async (input) =>
  createHash("sha256").update(input).digest("hex");

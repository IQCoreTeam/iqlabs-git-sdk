#!/usr/bin/env tsx
// Bootstrap the open `git_repos:all` registry table. Run ONCE per network
// by an admin-controlled keypair. Callers:
//
//   SOLANA_RPC_URL=... tsx scripts/bootstrap-registry.ts <keypair.json>
//
// Idempotent: if the account already exists this exits 0 without a
// transaction. The resulting PDA is deterministic (via REGISTRY_HINT) so
// there is nothing to commit to source afterwards — future readers derive
// it from the hint.

import { readFileSync } from "node:fs";
import { Connection, Keypair } from "@solana/web3.js";
import { setSha256 } from "../src/core/hash";
import { bootstrapRegistry } from "../src/layers/repo";
import { hashNode } from "../src/platform/hash-node";

setSha256(hashNode);

async function main(): Promise<void> {
  const keypairPath = process.argv[2];
  if (!keypairPath) {
    throw new Error("usage: tsx scripts/bootstrap-registry.ts <keypair.json>");
  }
  const rpc = process.env.SOLANA_RPC_URL;
  if (!rpc) {
    throw new Error("SOLANA_RPC_URL is required");
  }

  const secret = Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8")));
  const signer = Keypair.fromSecretKey(secret);
  const connection = new Connection(rpc, "confirmed");

  const sig = await bootstrapRegistry(connection, signer);
  console.log(sig ? `bootstrapped: ${sig}` : "already bootstrapped");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

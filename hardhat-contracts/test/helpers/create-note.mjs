/**
 * ESM helper for Hardhat e2e-flow.ts.
 *
 * Why a separate file?
 *   Hardhat runs TypeScript as CommonJS. @redsand/sdk is ESM-only, so we
 *   cannot `import` it from e2e-flow.ts. This helper runs under native Node ESM.
 *
 * Env:
 *   E2E_AMOUNT — raw ERC-20 amount (must equal Vault.denomination)
 *   E2E_TOKEN  — ERC-20 address (Vault.token / MockUSDC)
 *
 * Output:
 *   One JSON line with commitmentBytes32, nullifierBytes32, recipientDigestBytes32.
 */
import {
  createNote,
  noteToJSON,
  frToBytes32,
} from "../../../sdk/dist/index.js";

const amount = BigInt(process.env.E2E_AMOUNT || "0");
const token = process.env.E2E_TOKEN || "";
if (!amount || !token) {
  console.error("E2E_AMOUNT and E2E_TOKEN required");
  process.exit(1);
}

// Build a fresh note: secret is random; recipientDigest is a non-zero Fr.
const note = await createNote({
  recipientDigest: 1n,
  amount,
  token,
});

const json = noteToJSON(note);
process.stdout.write(
  JSON.stringify({
    ...json,
    recipientDigestBytes32: frToBytes32(note.recipientDigest),
  }) + "\n"
);

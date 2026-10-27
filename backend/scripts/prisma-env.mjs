#!/usr/bin/env node
/**
 * Ensures DATABASE_URL looks like PostgreSQL before running Prisma.
 * Usage:
 *   node scripts/prisma-env.mjs generate   # allows placeholder for CI/build
 *   node scripts/prisma-env.mjs db push    # requires a real Postgres URL
 */
import {spawnSync} from "node:child_process";
import {readFileSync, existsSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");

/** Load backend/.env into process.env if keys are unset. */
function loadDotEnv() {
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotEnv();

const args = process.argv.slice(2);
const mode = args[0] === "generate" ? "generate" : "require";

const uri = (process.env.DATABASE_URL || "").trim();
const ok =
  uri.startsWith("postgresql://") ||
  uri.startsWith("postgres://");

if (!ok) {
  if (mode === "generate") {
    process.env.DATABASE_URL =
      "postgresql://postgres:postgres@127.0.0.1:5432/redsand?schema=public";
    console.warn(
      "[prisma-env] DATABASE_URL missing/invalid at generate time — using local placeholder"
    );
  } else {
    console.error(`
DATABASE_URL must start with postgresql:// or postgres://
Current value: ${uri ? JSON.stringify(uri.slice(0, 48) + (uri.length > 48 ? "…" : "")) : "(empty / unset)"}

Example:
  DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/redsand?schema=public

Build Command:  pnpm install --ignore-workspace && pnpm db:generate
Start Command:  pnpm start
`);
    process.exit(1);
  }
}

const result = spawnSync("pnpm", ["exec", "prisma", ...args], {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
  cwd: root,
});
process.exit(result.status ?? 1);

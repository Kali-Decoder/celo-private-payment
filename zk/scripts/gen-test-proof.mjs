#!/usr/bin/env node
/**
 * Generate a valid withdraw Groth16 proof for a depth-20 tree with one leaf
 * at index 0. Writes proofs/ + inputs/ fixtures used by Hardhat tests.
 */
import {execSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const CIRCOM = process.env.CIRCOM || "circom";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const ART = path.join(ROOT, "artifacts");
const KEYS = path.join(ROOT, "keys");
const PROOFS = path.join(ROOT, "proofs");
const INPUTS = path.join(ROOT, "inputs");
const SNJ = path.join(ROOT, "node_modules/.bin/snarkjs");

function resolveCircom() {
  try {
    execSync(`${CIRCOM} --version`, {stdio: "pipe"});
    return CIRCOM;
  } catch {
    const home = process.env.HOME || "";
    for (const c of [`${home}/.local/bin/circom`, `${home}/.cargo/bin/circom`]) {
      if (fs.existsSync(c)) return c;
    }
    throw new Error("circom not found");
  }
}

const circom = resolveCircom();
const WASM = path.join(ART, "withdraw_js/withdraw.wasm");
const ZKEY = path.join(KEYS, "withdraw.zkey");
const VK = path.join(ART, "withdraw_vk.json");
const HELPER_SRC = path.join(ROOT, "circuits/compute_hashes.circom");
const HELPER_WASM = path.join(ART, "compute_hashes_js/compute_hashes.wasm");
const HELPER_SYM = path.join(ART, "compute_hashes.sym");

const SECRET = "12345";
const RECIPIENT_DIGEST = "42";
const AMOUNT = "10000000"; // 10 USDC (6 decimals)
const TOKEN_HASH = "1"; // placeholder; real value = uint160(token)

mkdirp(PROOFS);
mkdirp(INPUTS);

if (!fs.existsSync(HELPER_WASM)) {
  console.log("compiling compute_hashes.circom...");
  execSync(`${circom} ${HELPER_SRC} --wasm --sym -p bn128 -o ${ART}`, {
    stdio: "inherit",
  });
}

const helperInput = {
  secret: SECRET,
  recipientDigest: RECIPIENT_DIGEST,
  amount: AMOUNT,
  tokenHash: TOKEN_HASH,
};
const helperInputPath = path.join(ART, "_helper_input.json");
const helperWtnsPath = path.join(ART, "_helper.wtns");
const helperWtnsJsonPath = path.join(ART, "_helper_witness.json");
fs.writeFileSync(helperInputPath, JSON.stringify(helperInput));

console.log("computing helper witness...");
execSync(`${SNJ} wtns calculate ${HELPER_WASM} ${helperInputPath} ${helperWtnsPath}`, {
  stdio: "pipe",
});
execSync(`${SNJ} wtns export json ${helperWtnsPath} ${helperWtnsJsonPath}`, {
  stdio: "pipe",
});

const helperSymLines = fs.readFileSync(HELPER_SYM, "utf8").trim().split("\n");
const helperSigIdx = {};
for (const line of helperSymLines) {
  const parts = line.split(",");
  if (parts.length < 4) continue;
  helperSigIdx[parts[3].trim()] = parseInt(parts[0], 10);
}
const helperWitness = JSON.parse(fs.readFileSync(helperWtnsJsonPath, "utf8"));

function getHelperSignal(name) {
  const idx = helperSigIdx[name];
  if (idx === undefined) throw new Error(`signal not found: ${name}`);
  return helperWitness[idx];
}

const computedNullifier = getHelperSignal("main.nullifier");
const computedRoot = getHelperSignal("main.root");

// pathElements[i] = empty[i]; circom may optimize empty[0]=0 away from sym.
const pathElements = [];
for (let i = 0; i < 20; i++) {
  const key = `main.zeroHashes[${i}]`;
  if (helperSigIdx[key] !== undefined) {
    pathElements.push(getHelperSignal(key));
  } else if (i === 0) {
    pathElements.push("0");
  } else {
    throw new Error(`missing ${key} in helper sym`);
  }
}
const pathIndices = Array(20).fill(0);

const input = {
  root: computedRoot,
  nullifier: computedNullifier,
  recipientDigest: RECIPIENT_DIGEST,
  amount: AMOUNT,
  tokenHash: TOKEN_HASH,
  secret: SECRET,
  pathElements,
  pathIndices,
};

const inputPath = path.join(INPUTS, "withdraw_input.json");
fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));
console.log("wrote", inputPath);

if (!fs.existsSync(WASM) || !fs.existsSync(ZKEY)) {
  throw new Error("missing withdraw.wasm or withdraw.zkey — run scripts/build.sh first");
}

const wtnsPath = path.join(PROOFS, "withdraw.wtns");
const proofPath = path.join(PROOFS, "withdraw_proof.json");
const publicPath = path.join(PROOFS, "withdraw_public.json");

console.log("proving...");
execSync(`${SNJ} groth16 fullprove ${inputPath} ${WASM} ${ZKEY} ${proofPath} ${publicPath}`, {
  stdio: "inherit",
});

console.log("verifying...");
execSync(`${SNJ} groth16 verify ${VK} ${publicPath} ${proofPath}`, {stdio: "inherit"});

console.log("OK");
console.log("  proof: ", proofPath);
console.log("  public:", publicPath);

function mkdirp(p) {
  fs.mkdirSync(p, {recursive: true});
}

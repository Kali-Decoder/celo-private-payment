#!/usr/bin/env node
/**
 * Export snarkjs Solidity verifier and wrap it as Redsand IVerifier-compatible
 * adapter at hardhat-contracts/contracts/verifiers/WithdrawVerifier.sol + Groth16Verifier.sol
 */
import {execSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const KEYS = path.join(ROOT, "keys");
const CONTRACTS = path.join(ROOT, "..", "hardhat-contracts", "contracts", "verifiers");
const SNJ = path.join(ROOT, "node_modules/.bin/snarkjs");
const ZKEY = path.join(KEYS, "withdraw.zkey");

if (!fs.existsSync(ZKEY)) {
  throw new Error(`missing ${ZKEY} — run scripts/build.sh first`);
}

fs.mkdirSync(CONTRACTS, {recursive: true});

const rawPath = path.join(CONTRACTS, "Groth16Verifier.sol");
console.log("exporting Groth16Verifier.sol...");
execSync(`${SNJ} zkey export solidityverifier ${ZKEY} ${rawPath}`, {stdio: "inherit"});

// snarkjs names the contract `Groth16Verifier` in recent versions, or `Verifier`.
let raw = fs.readFileSync(rawPath, "utf8");
// Normalize SPDX / pragma if missing
if (!raw.includes("SPDX-License-Identifier")) {
  raw = `// SPDX-License-Identifier: GPL-3.0\n${raw}`;
}
// Ensure contract name is Groth16Verifier
raw = raw.replace(/contract\s+Verifier\b/, "contract Groth16Verifier");
fs.writeFileSync(rawPath, raw);

const wrapper = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVerifier} from "../interfaces/IVerifier.sol";
import {Groth16Verifier} from "./Groth16Verifier.sol";

/// @title WithdrawVerifier
/// @notice Adapts snarkjs Groth16Verifier to Redsand's IVerifier interface.
/// @dev Public input order (LOCKED):
///      [root, nullifier, recipientDigest, amount, tokenHash]
contract WithdrawVerifier is IVerifier {
    Groth16Verifier public immutable groth16;

    error MalformedProof();

    constructor() {
        groth16 = new Groth16Verifier();
    }

    /// @inheritdoc IVerifier
    function verifyProof(
        bytes calldata proof,
        bytes32 root,
        bytes32 nullifier,
        bytes32 recipientDigest,
        uint256 amount,
        uint256 tokenHash
    ) external view returns (bool) {
        // proof = abi.encode(uint256[2] a, uint256[2][2] b, uint256[2] c)
        if (proof.length != 256) revert MalformedProof();

        uint256[8] memory p = abi.decode(proof, (uint256[8]));
        // Layout: a0,a1, b00,b01,b10,b11, c0,c1  (snarkjs calldata flattened)
        // We encode as: a[2] || b[2][2] || c[2] packed into 8 words:
        //   [a0, a1, b00, b01, b10, b11, c0, c1]
        uint256[2] memory a = [p[0], p[1]];
        uint256[2][2] memory b = [[p[2], p[3]], [p[4], p[5]]];
        uint256[2] memory c = [p[6], p[7]];

        uint256[5] memory pubSignals;
        pubSignals[0] = uint256(root);
        pubSignals[1] = uint256(nullifier);
        pubSignals[2] = uint256(recipientDigest);
        pubSignals[3] = amount;
        pubSignals[4] = tokenHash;

        return groth16.verifyProof(a, b, c, pubSignals);
    }
}
`;

const wrapperPath = path.join(CONTRACTS, "WithdrawVerifier.sol");
fs.writeFileSync(wrapperPath, wrapper);
console.log("wrote", wrapperPath);
console.log("wrote", rawPath);

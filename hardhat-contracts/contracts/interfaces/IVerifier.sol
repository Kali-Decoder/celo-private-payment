// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IVerifier
/// @notice ZK proof verifier used by Vault on redeem.
/// @dev Public input order is LOCKED to the withdraw circuit (zk/PROTOCOL.md):
///      [root, nullifier, recipientDigest, amount, tokenHash]
interface IVerifier {
    /// @notice Verify a redeem / withdrawal Groth16 proof.
    /// @param proof Encoded proof bytes (see WithdrawVerifier / SDK `encodeProof`).
    /// @param root Merkle root the note membership is proven against.
    /// @param nullifier Nullifier = Poseidon([secret]).
    /// @param recipientDigest Stealth recipient digest bound in the commitment.
    /// @param amount Raw ERC-20 amount bound in the commitment.
    /// @param tokenHash `uint256(uint160(token))` bound in the commitment.
    /// @return True if the proof is valid.
    function verifyProof(
        bytes calldata proof,
        bytes32 root,
        bytes32 nullifier,
        bytes32 recipientDigest,
        uint256 amount,
        uint256 tokenHash
    ) external view returns (bool);
}

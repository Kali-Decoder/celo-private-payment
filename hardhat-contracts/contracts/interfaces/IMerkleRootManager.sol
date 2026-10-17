// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IMerkleRootManager
/// @notice Rolling window of valid Merkle roots for note membership proofs.
interface IMerkleRootManager {
    /// @notice Whether `root` is currently in the known-root window.
    function isKnownRoot(bytes32 root) external view returns (bool);

    /// @notice Most recently posted root (bytes32(0) if none yet).
    function latestRoot() external view returns (bytes32);

    /// @notice Post a new root into the rolling window. Access-controlled by implementer.
    function postRoot(bytes32 root) external;
}

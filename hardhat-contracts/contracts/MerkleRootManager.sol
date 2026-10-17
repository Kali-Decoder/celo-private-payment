// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {IMerkleRootManager} from "./interfaces/IMerkleRootManager.sol";

/// @title MerkleRootManager
/// @notice Stores the last 64 posted Merkle roots (Option B: tree off-chain).
/// @dev Only the owner (typically the deposit indexer / relayer) may post roots.
///      Vault reads `isKnownRoot` and never writes roots itself.
contract MerkleRootManager is Ownable2Step, IMerkleRootManager {
    uint256 public constant ROOT_WINDOW = 64;

    /// @dev Presence map for O(1) membership checks.
    mapping(bytes32 => bool) private _known;

    /// @dev Ring buffer of roots in insertion order.
    bytes32[ROOT_WINDOW] private _roots;

    /// @dev Next write slot in the ring buffer (mod ROOT_WINDOW).
    uint8 private _currentIndex;

    /// @dev Number of roots ever posted (capped conceptually by uint256; used for latestRoot).
    uint256 private _postedCount;

    error ZeroRoot();
    error RootAlreadyKnown();
    error InvalidSlot();

    event RootPosted(bytes32 indexed root, uint8 indexed slot, uint256 postedCount);

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @inheritdoc IMerkleRootManager
    function postRoot(bytes32 root) external onlyOwner {
        if (root == bytes32(0)) revert ZeroRoot();
        if (_known[root]) revert RootAlreadyKnown();

        uint8 slot = _currentIndex;
        bytes32 evicted = _roots[slot];
        if (evicted != bytes32(0)) {
            _known[evicted] = false;
        }

        _roots[slot] = root;
        _known[root] = true;
        _currentIndex = uint8((uint256(slot) + 1) % ROOT_WINDOW);
        unchecked {
            ++_postedCount;
        }

        emit RootPosted(root, slot, _postedCount);
    }

    /// @inheritdoc IMerkleRootManager
    function isKnownRoot(bytes32 root) external view returns (bool) {
        return root != bytes32(0) && _known[root];
    }

    /// @inheritdoc IMerkleRootManager
    function latestRoot() external view returns (bytes32) {
        if (_postedCount == 0) return bytes32(0);
        uint256 lastSlot = (_currentIndex + ROOT_WINDOW - 1) % ROOT_WINDOW;
        return _roots[lastSlot];
    }

    /// @notice Root stored at ring-buffer slot `i` (0..63).
    function rootAt(uint256 i) external view returns (bytes32) {
        if (i >= ROOT_WINDOW) revert InvalidSlot();
        return _roots[i];
    }

    /// @notice Next write index in the ring buffer.
    function currentIndex() external view returns (uint8) {
        return _currentIndex;
    }

    /// @notice Total roots posted since deployment.
    function postedCount() external view returns (uint256) {
        return _postedCount;
    }
}

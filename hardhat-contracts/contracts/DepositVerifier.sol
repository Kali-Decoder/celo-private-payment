// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVerifier} from "./interfaces/IVerifier.sol";

/// @title DepositVerifier
/// @notice Temporary mock verifier. Always returns true.
/// @dev Replace via Vault.setVerifier with WithdrawVerifier after
///      `zk/scripts/build.sh`. Do not deploy this mock with real funds.
contract DepositVerifier is IVerifier {
    /// @inheritdoc IVerifier
    function verifyProof(
        bytes calldata /* proof */,
        bytes32 /* root */,
        bytes32 /* nullifier */,
        bytes32 /* recipientDigest */,
        uint256 /* amount */,
        uint256 /* tokenHash */
    ) external pure returns (bool) {
        return true;
    }
}

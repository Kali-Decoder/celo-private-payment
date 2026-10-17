// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVerifier} from "../interfaces/IVerifier.sol";

/// @dev Test-only verifier that always rejects. Not for production.
contract RejectingVerifier is IVerifier {
    function verifyProof(
        bytes calldata,
        bytes32,
        bytes32,
        bytes32,
        uint256,
        uint256
    ) external pure returns (bool) {
        return false;
    }
}

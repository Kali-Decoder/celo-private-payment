// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockUSDC
/// @notice 6-decimal test ERC-20 for local / testnet deposits.
contract MockUSDC is ERC20, Ownable {
    uint8 private immutable _decimals;

    constructor(address initialOwner) ERC20("USD Coin", "USDC") Ownable(initialOwner) {
        _decimals = 6;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Mint tokens for testing. Owner only.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}

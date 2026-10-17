// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

/// @title FeeManager (UUPS upgradeable)
contract FeeManager is Initializable, AccessControlUpgradeable, UUPSUpgradeable {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    uint256 public constant BPS_DENOMINATOR = 10_000;

    struct FeeConfig {
        uint256 flatFee;
        uint256 percentBps;
        bool active;
    }

    mapping(address => FeeConfig) public feeConfigs;

    uint256[49] private __gap;

    event FeeConfigUpdated(address indexed token, uint256 flatFee, uint256 percentBps);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        require(admin != address(0), "zero admin");
        __AccessControl_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
        feeConfigs[address(0)] = FeeConfig({flatFee: 0, percentBps: 30, active: true});
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}

    function setFeeConfig(address token, uint256 flatFee, uint256 percentBps) external onlyRole(ADMIN_ROLE) {
        require(percentBps <= BPS_DENOMINATOR, "percent too high");
        feeConfigs[token] = FeeConfig({flatFee: flatFee, percentBps: percentBps, active: true});
        emit FeeConfigUpdated(token, flatFee, percentBps);
    }

    function computeFee(address token, uint256 amount) external view returns (uint256 feeAmount) {
        FeeConfig memory cfg = feeConfigs[token].active ? feeConfigs[token] : feeConfigs[address(0)];
        feeAmount = cfg.flatFee + (amount * cfg.percentBps) / BPS_DENOMINATOR;
    }

    /// @notice Flat fee component for a token (percent ignored).
    function flatFeeOf(address token) external view returns (uint256 flatFee) {
        FeeConfig memory cfg = feeConfigs[token].active ? feeConfigs[token] : feeConfigs[address(0)];
        flatFee = cfg.flatFee;
    }
}

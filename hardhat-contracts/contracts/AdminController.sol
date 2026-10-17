// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

interface IPausable {
    function pause() external;
    function unpause() external;
}

interface IOwnable2Step {
    function acceptOwnership() external;
    function owner() external view returns (address);
}

interface IUUPS {
    function upgradeToAndCall(address newImplementation, bytes memory data) external payable;
}

interface IVaultAdmin {
    function setToken(address token, uint256 denomination) external;
    function setSupportedToken(address token, bool supported) external;
    function setNftContract(address nft) external;
    function setFeeManager(address feeManager) external;
    function setFeeRecipient(address feeRecipient) external;
    function setVerifier(address verifier) external;
    function setRootManager(address rootManager) external;
    function emergencyWithdraw(address token, address to, uint256 amount) external;
}

interface IFeeAdmin {
    function setFeeConfig(address token, uint256 flatFee, uint256 percentBps) external;
}

/// @title AdminController (UUPS upgradeable)
/// @notice Top-level ops + upgrade hub for Vault / FeeManager / PaymentNFT / Treasury proxies.
contract AdminController is Initializable, AccessControlUpgradeable, UUPSUpgradeable {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    address public vault;
    address public feeManager;
    address public paymentNft;
    address public treasury;
    address[] public pausableContracts;

    uint256[44] private __gap;

    event VaultUpdated(address vault);
    event FeeManagerUpdated(address feeManager);
    event PaymentNftUpdated(address paymentNft);
    event TreasuryUpdated(address treasury);
    event ProtocolPaused(address indexed by);
    event ProtocolUnpaused(address indexed by);
    event TokenConfigured(address indexed token, uint256 denomination);
    event SupportedTokenUpdated(address indexed token, bool supported);
    event FeeConfigSet(address indexed token, uint256 flatFee, uint256 percentBps);
    event FeeRecipientSet(address indexed feeRecipient);
    event VerifierSet(address indexed verifier);
    event RootManagerSet(address indexed rootManager);
    event NftContractSet(address indexed nft);
    event ProxyUpgraded(address indexed proxy, address indexed newImplementation);

    error ZeroAddress();
    error VaultNotSet();
    error FeeManagerNotSet();
    error TargetNotSet();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address multisigAdmin) external initializer {
        if (multisigAdmin == address(0)) revert ZeroAddress();
        __AccessControl_init();

        _grantRole(DEFAULT_ADMIN_ROLE, multisigAdmin);
        _grantRole(OPERATOR_ROLE, multisigAdmin);
        _grantRole(EMERGENCY_ROLE, multisigAdmin);
        _grantRole(UPGRADER_ROLE, multisigAdmin);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}

    // ── wiring ──────────────────────────────────────────────────────────────

    function setVault(address _vault) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_vault == address(0)) revert ZeroAddress();
        vault = _vault;
        emit VaultUpdated(_vault);
    }

    function setFeeManager(address _feeManager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_feeManager == address(0)) revert ZeroAddress();
        feeManager = _feeManager;
        emit FeeManagerUpdated(_feeManager);
    }

    function setPaymentNft(address _nft) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_nft == address(0)) revert ZeroAddress();
        paymentNft = _nft;
        emit PaymentNftUpdated(_nft);
    }

    function setTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function setPausableContracts(address[] calldata contracts_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        pausableContracts = contracts_;
    }

    function acceptVaultOwnership() external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (vault == address(0)) revert VaultNotSet();
        IOwnable2Step(vault).acceptOwnership();
    }

    // ── UUPS upgrades (AdminController must hold upgrade authority on targets) ─

    function upgradeVault(address newImplementation, bytes calldata data)
        external
        onlyRole(UPGRADER_ROLE)
    {
        if (vault == address(0)) revert VaultNotSet();
        IUUPS(vault).upgradeToAndCall(newImplementation, data);
        emit ProxyUpgraded(vault, newImplementation);
    }

    function upgradeFeeManager(address newImplementation, bytes calldata data)
        external
        onlyRole(UPGRADER_ROLE)
    {
        if (feeManager == address(0)) revert FeeManagerNotSet();
        IUUPS(feeManager).upgradeToAndCall(newImplementation, data);
        emit ProxyUpgraded(feeManager, newImplementation);
    }

    function upgradePaymentNft(address newImplementation, bytes calldata data)
        external
        onlyRole(UPGRADER_ROLE)
    {
        if (paymentNft == address(0)) revert TargetNotSet();
        IUUPS(paymentNft).upgradeToAndCall(newImplementation, data);
        emit ProxyUpgraded(paymentNft, newImplementation);
    }

    function upgradeTreasury(address newImplementation, bytes calldata data)
        external
        onlyRole(UPGRADER_ROLE)
    {
        if (treasury == address(0)) revert TargetNotSet();
        IUUPS(treasury).upgradeToAndCall(newImplementation, data);
        emit ProxyUpgraded(treasury, newImplementation);
    }

    // ── pause ───────────────────────────────────────────────────────────────

    function emergencyPauseAll() external onlyRole(EMERGENCY_ROLE) {
        for (uint256 i = 0; i < pausableContracts.length; i++) {
            IPausable(pausableContracts[i]).pause();
        }
        emit ProtocolPaused(msg.sender);
    }

    function unpauseAll() external onlyRole(OPERATOR_ROLE) {
        for (uint256 i = 0; i < pausableContracts.length; i++) {
            IPausable(pausableContracts[i]).unpause();
        }
        emit ProtocolUnpaused(msg.sender);
    }

    // ── vault config ────────────────────────────────────────────────────────

    function configureVaultToken(address token, uint256 denomination) external onlyRole(OPERATOR_ROLE) {
        _requireVault();
        IVaultAdmin(vault).setToken(token, denomination);
        emit TokenConfigured(token, denomination);
    }

    /// @notice Enable/disable a token for variable-amount `depositTo` (any amount > 0).
    function setVaultSupportedToken(address token, bool supported) external onlyRole(OPERATOR_ROLE) {
        _requireVault();
        IVaultAdmin(vault).setSupportedToken(token, supported);
        emit SupportedTokenUpdated(token, supported);
    }

    function setVaultNft(address nft) external onlyRole(OPERATOR_ROLE) {
        _requireVault();
        IVaultAdmin(vault).setNftContract(nft);
        emit NftContractSet(nft);
    }

    function setVaultFeeManager(address feeManager_) external onlyRole(OPERATOR_ROLE) {
        _requireVault();
        IVaultAdmin(vault).setFeeManager(feeManager_);
        emit FeeManagerUpdated(feeManager_);
    }

    function setFeeRecipient(address feeRecipient) external onlyRole(OPERATOR_ROLE) {
        _requireVault();
        IVaultAdmin(vault).setFeeRecipient(feeRecipient);
        emit FeeRecipientSet(feeRecipient);
    }

    function setVerifier(address verifier) external onlyRole(OPERATOR_ROLE) {
        _requireVault();
        IVaultAdmin(vault).setVerifier(verifier);
        emit VerifierSet(verifier);
    }

    function setRootManager(address rootManager) external onlyRole(OPERATOR_ROLE) {
        _requireVault();
        IVaultAdmin(vault).setRootManager(rootManager);
        emit RootManagerSet(rootManager);
    }

    function setFeeConfig(address token, uint256 flatFee, uint256 percentBps) external onlyRole(OPERATOR_ROLE) {
        if (feeManager == address(0)) revert FeeManagerNotSet();
        IFeeAdmin(feeManager).setFeeConfig(token, flatFee, percentBps);
        emit FeeConfigSet(token, flatFee, percentBps);
    }

    function emergencyWithdrawFromVault(address token, address to, uint256 amount)
        external
        onlyRole(EMERGENCY_ROLE)
    {
        _requireVault();
        IVaultAdmin(vault).emergencyWithdraw(token, to, amount);
    }

    function pausableContractsLength() external view returns (uint256) {
        return pausableContracts.length;
    }

    function _requireVault() internal view {
        if (vault == address(0)) revert VaultNotSet();
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IVerifier} from "./interfaces/IVerifier.sol";
import {IMerkleRootManager} from "./interfaces/IMerkleRootManager.sol";

interface IPaymentNFT {
    function mintFor(address to, uint256 depositId, string calldata metadataURI)
        external
        returns (uint256 tokenId);
    function burnFor(uint256 tokenId, address caller) external;
    function ownerOf(uint256 tokenId) external view returns (address);
    function setRedemptionProof(
        uint256 tokenId,
        bytes calldata proof,
        bytes32 root,
        bytes32 nullifier,
        bytes32 recipientDigest
    ) external;
    function getRedemptionProof(uint256 tokenId)
        external
        view
        returns (bytes memory proof, bytes32 root, bytes32 nullifier, bytes32 recipientDigest);
}

interface IFeeManager {
    function computeFee(address token, uint256 amount) external view returns (uint256 feeAmount);
}

/// @title Vault (UUPS upgradeable)
/// @notice Private payment pool with claim NFTs — variable amount, multi-token, mint-to-recipient.
/// @dev Storage layout: append-only. Do not reorder/remove existing state vars.
contract Vault is
    Initializable,
    Ownable2StepUpgradeable,
    PausableUpgradeable,
    ReentrancyGuard,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    struct DepositInfo {
        uint256 tokenId;
        bytes32 commitment;
        bool redeemed;
        /// @dev Appended for UI-aligned deposits (token + amount per deposit).
        address token;
        uint256 amount;
    }

    IVerifier public verifier;
    IMerkleRootManager public rootManager;
    IPaymentNFT public nftContract;
    IFeeManager public feeManager;

    address public feeRecipient;
    /// @dev Legacy default token (still used by deposit(commitment) helper).
    address public token;
    /// @dev Legacy default amount (still used by deposit(commitment) helper).
    uint256 public denomination;

    mapping(bytes32 => bool) public nullifierSpent;
    mapping(bytes32 => bool) public commitments;
    mapping(uint256 => DepositInfo) public deposits;
    mapping(bytes32 => uint256) public commitmentToDepositId;

    uint256 public nextDepositId;
    uint32 public depositCounter;

    /// @dev Tokens allowed for variable-amount deposits.
    mapping(address => bool) public supportedTokens;

    /// @dev Reserved for future Vault storage (append new vars above this gap).
    uint256[39] private __gap;

    error ZeroAddress();
    error InvalidCommitment();
    error CommitmentExists();
    error TokenNotConfigured();
    error TokenNotSupported();
    error NftNotConfigured();
    error DepositMissing();
    error AlreadyRedeemed();
    error NotClaimOwner();
    error NoProofStaged();
    error RootNotFound();
    error NullifierAlreadyUsed();
    error InvalidProof();
    error TokenAlreadySet();
    error InvalidDenomination();
    error InvalidAmount();

    event Deposit(
        bytes32 indexed commitment,
        uint32 indexed leafIndex,
        address indexed token,
        uint256 amount,
        uint256 depositId,
        uint256 tokenId
    );
    event PaymentIssued(
        uint256 indexed depositId,
        uint256 indexed tokenId,
        address indexed recipient,
        address depositor,
        string noteURI
    );
    event Redeemed(
        uint256 indexed depositId,
        bytes32 indexed nullifier,
        address indexed to,
        address feeRecipient,
        uint256 fee,
        uint256 payout
    );
    event TokenConfigured(address indexed token, uint256 denomination);
    event SupportedTokenUpdated(address indexed token, bool supported);
    event NftContractUpdated(address indexed nft);
    event FeeManagerUpdated(address indexed feeManager);
    event FeeRecipientUpdated(address indexed feeRecipient);
    event VerifierUpdated(address indexed previous, address indexed current);
    event RootManagerUpdated(address indexed previous, address indexed current);
    event EmergencyWithdraw(address indexed token, address indexed to, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address initialOwner,
        address verifier_,
        address rootManager_,
        address feeRecipient_
    ) external initializer {
        if (
            initialOwner == address(0) || verifier_ == address(0) || rootManager_ == address(0)
                || feeRecipient_ == address(0)
        ) {
            revert ZeroAddress();
        }

        __Ownable_init(initialOwner);
        __Ownable2Step_init();
        __Pausable_init();

        verifier = IVerifier(verifier_);
        rootManager = IMerkleRootManager(rootManager_);
        feeRecipient = feeRecipient_;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function tokenHashOf(address token_) public pure returns (uint256) {
        return uint256(uint160(token_));
    }

    function setNftContract(address nft) external onlyOwner {
        if (nft == address(0)) revert ZeroAddress();
        nftContract = IPaymentNFT(nft);
        emit NftContractUpdated(nft);
    }

    function setFeeManager(address feeManager_) external onlyOwner {
        feeManager = IFeeManager(feeManager_);
        emit FeeManagerUpdated(feeManager_);
    }

    function setFeeRecipient(address feeRecipient_) external onlyOwner {
        if (feeRecipient_ == address(0)) revert ZeroAddress();
        feeRecipient = feeRecipient_;
        emit FeeRecipientUpdated(feeRecipient_);
    }

    function setVerifier(address verifier_) external onlyOwner {
        if (verifier_ == address(0)) revert ZeroAddress();
        address previous = address(verifier);
        verifier = IVerifier(verifier_);
        emit VerifierUpdated(previous, verifier_);
    }

    function setRootManager(address rootManager_) external onlyOwner {
        if (rootManager_ == address(0)) revert ZeroAddress();
        address previous = address(rootManager);
        rootManager = IMerkleRootManager(rootManager_);
        emit RootManagerUpdated(previous, rootManager_);
    }

    /// @notice Sets legacy default token/denomination and marks the token as supported.
    function setToken(address token_, uint256 denomination_) external onlyOwner {
        if (depositCounter != 0 || nextDepositId != 0) revert TokenAlreadySet();
        if (token_ == address(0)) revert ZeroAddress();
        if (denomination_ == 0) revert InvalidDenomination();
        token = token_;
        denomination = denomination_;
        supportedTokens[token_] = true;
        emit TokenConfigured(token_, denomination_);
        emit SupportedTokenUpdated(token_, true);
    }

    /// @notice Enable/disable a token for `depositTo` (UI token picker).
    function setSupportedToken(address token_, bool supported) external onlyOwner {
        if (token_ == address(0)) revert ZeroAddress();
        supportedTokens[token_] = supported;
        emit SupportedTokenUpdated(token_, supported);
    }

    /**
     * @notice Legacy helper: deposit default denomination of default token to msg.sender.
     */
    function deposit(bytes32 commitment)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 depositId, uint256 tokenId)
    {
        return _deposit(commitment, token, denomination, msg.sender, "");
    }

    /**
     * @notice UI-aligned deposit: choose token, amount, NFT recipient, and optional note URI.
     * @param commitment Poseidon note commitment (bytes32).
     * @param token_ ERC-20 to lock (must be supported).
     * @param amount Amount to lock (must match note amount used in ZK).
     * @param recipient NFT recipient; address(0) → msg.sender.
     * @param noteURI Optional metadata / encrypted-note URI stored on the PaymentNFT.
     */
    function depositTo(
        bytes32 commitment,
        address token_,
        uint256 amount,
        address recipient,
        string calldata noteURI
    ) external nonReentrant whenNotPaused returns (uint256 depositId, uint256 tokenId) {
        return _deposit(commitment, token_, amount, recipient, noteURI);
    }

    function _deposit(
        bytes32 commitment,
        address token_,
        uint256 amount,
        address recipient,
        string memory noteURI
    ) internal returns (uint256 depositId, uint256 tokenId) {
        if (address(nftContract) == address(0)) revert NftNotConfigured();
        if (token_ == address(0)) revert TokenNotConfigured();
        if (!supportedTokens[token_]) revert TokenNotSupported();
        if (amount == 0) revert InvalidAmount();
        if (commitment == bytes32(0)) revert InvalidCommitment();
        if (commitments[commitment]) revert CommitmentExists();

        address to = recipient == address(0) ? msg.sender : recipient;

        uint32 leafIndex = depositCounter;
        unchecked {
            depositCounter = leafIndex + 1;
        }

        commitments[commitment] = true;
        IERC20(token_).safeTransferFrom(msg.sender, address(this), amount);

        depositId = nextDepositId++;
        tokenId = nftContract.mintFor(to, depositId, noteURI);

        deposits[depositId] = DepositInfo({
            tokenId: tokenId,
            commitment: commitment,
            redeemed: false,
            token: token_,
            amount: amount
        });
        commitmentToDepositId[commitment] = depositId;

        emit Deposit(commitment, leafIndex, token_, amount, depositId, tokenId);
        emit PaymentIssued(depositId, tokenId, to, msg.sender, noteURI);
    }

    function redeem(uint256 depositId) external nonReentrant whenNotPaused {
        DepositInfo storage d = deposits[depositId];
        if (d.commitment == bytes32(0)) revert DepositMissing();
        if (d.redeemed) revert AlreadyRedeemed();
        if (nftContract.ownerOf(d.tokenId) != msg.sender) revert NotClaimOwner();

        (bytes memory proof, bytes32 root, bytes32 nullifier, bytes32 recipientDigest) =
            nftContract.getRedemptionProof(d.tokenId);

        if (proof.length == 0) revert NoProofStaged();
        if (nullifier == bytes32(0) || recipientDigest == bytes32(0)) revert InvalidProof();
        if (!rootManager.isKnownRoot(root)) revert RootNotFound();
        if (nullifierSpent[nullifier]) revert NullifierAlreadyUsed();

        // Prefer per-deposit fields; fall back to legacy global token/denomination.
        address payToken = d.token != address(0) ? d.token : token;
        uint256 payAmount = d.amount != 0 ? d.amount : denomination;
        if (payToken == address(0) || payAmount == 0) revert TokenNotConfigured();

        uint256 fee = 0;
        if (address(feeManager) != address(0)) {
            fee = feeManager.computeFee(payToken, payAmount);
            if (fee > payAmount) fee = payAmount;
        }

        uint256 tokenHash = tokenHashOf(payToken);
        if (!verifier.verifyProof(proof, root, nullifier, recipientDigest, payAmount, tokenHash)) {
            revert InvalidProof();
        }

        d.redeemed = true;
        nullifierSpent[nullifier] = true;

        uint256 payout = payAmount - fee;
        nftContract.burnFor(d.tokenId, msg.sender);

        if (fee > 0) {
            IERC20(payToken).safeTransfer(feeRecipient, fee);
        }
        IERC20(payToken).safeTransfer(msg.sender, payout);

        emit Redeemed(depositId, nullifier, msg.sender, feeRecipient, fee, payout);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function emergencyWithdraw(address token_, address to, uint256 amount) external onlyOwner whenPaused {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token_).safeTransfer(to, amount);
        emit EmergencyWithdraw(token_, to, amount);
    }
}

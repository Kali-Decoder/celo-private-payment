// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {ERC721BurnableUpgradeable} from
    "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721BurnableUpgradeable.sol";

/// @title PaymentNFT (UUPS upgradeable)
contract PaymentNFT is
    Initializable,
    ERC721Upgradeable,
    ERC721BurnableUpgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    struct PaymentMeta {
        uint256 depositId;
        string metadataURI;
    }

    struct RedemptionProof {
        bytes proof;
        bytes32 root;
        bytes32 nullifier;
        bytes32 recipientDigest;
    }

    mapping(uint256 => PaymentMeta) public metaOf;
    mapping(uint256 => uint256) public depositIdToTokenId;
    mapping(uint256 => RedemptionProof) private _redemptionProofs;
    uint256 private _nextTokenId;

    uint256[45] private __gap;

    event MetadataSet(uint256 indexed tokenId, string metadataURI);
    event RedemptionProofSet(
        uint256 indexed tokenId, bytes32 root, bytes32 nullifier, bytes32 recipientDigest
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        require(admin != address(0), "zero admin");
        __ERC721_init("Private Payment Claim", "PPC");
        __ERC721Burnable_init();
        __AccessControl_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}

    function setVault(address vault) external onlyRole(ADMIN_ROLE) {
        _grantRole(VAULT_ROLE, vault);
    }

    function mintFor(address to, uint256 depositId) external onlyRole(VAULT_ROLE) returns (uint256 tokenId) {
        return mintFor(to, depositId, "");
    }

    function mintFor(address to, uint256 depositId, string memory metadataURI)
        public
        onlyRole(VAULT_ROLE)
        returns (uint256 tokenId)
    {
        tokenId = ++_nextTokenId;
        _safeMint(to, tokenId);
        metaOf[tokenId] = PaymentMeta({depositId: depositId, metadataURI: metadataURI});
        depositIdToTokenId[depositId] = tokenId;
        if (bytes(metadataURI).length != 0) {
            emit MetadataSet(tokenId, metadataURI);
        }
    }

    function setMetadataURI(uint256 tokenId, string calldata uri) external {
        require(ownerOf(tokenId) == msg.sender, "not owner");
        metaOf[tokenId].metadataURI = uri;
        emit MetadataSet(tokenId, uri);
    }

    function setRedemptionProof(
        uint256 tokenId,
        bytes calldata proof,
        bytes32 root,
        bytes32 nullifier,
        bytes32 recipientDigest
    ) external {
        require(ownerOf(tokenId) == msg.sender, "not owner");
        require(proof.length > 0, "empty proof");
        require(nullifier != bytes32(0), "zero nullifier");
        require(recipientDigest != bytes32(0), "zero digest");
        _redemptionProofs[tokenId] = RedemptionProof({
            proof: proof,
            root: root,
            nullifier: nullifier,
            recipientDigest: recipientDigest
        });
        emit RedemptionProofSet(tokenId, root, nullifier, recipientDigest);
    }

    function getRedemptionProof(uint256 tokenId)
        external
        view
        returns (bytes memory proof, bytes32 root, bytes32 nullifier, bytes32 recipientDigest)
    {
        RedemptionProof storage p = _redemptionProofs[tokenId];
        return (p.proof, p.root, p.nullifier, p.recipientDigest);
    }

    function burnFor(uint256 tokenId, address caller) external onlyRole(VAULT_ROLE) {
        require(ownerOf(tokenId) == caller, "not current owner");
        delete _redemptionProofs[tokenId];
        _burn(tokenId);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return metaOf[tokenId].metadataURI;
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Upgradeable, AccessControlUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}

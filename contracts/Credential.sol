// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ICredential.sol";
import "./IRegistry.sol";

/// @title CredentialContract
/// @notice Issues, revokes, and verifies academic credentials via keccak256 hashes.
/// @dev Raw credential data is never stored on-chain. Only hashes are recorded.
///      metadataURI stores an IPFS reference ("ipfs://CID") to the off-chain document.
contract CredentialContract is ICredential {
    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    struct Credential {
        bytes32 credentialHash; // keccak256 of off-chain credential data
        address issuer;
        address holder;
        bool revoked;
        uint256 issuedAt;       // 0 = does not exist (used as existence sentinel)
        string metadataURI;     // ipfs://CID or empty string
    }

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    IRegistry public immutable registry;

    /// @dev credentialHash => Credential
    mapping(bytes32 => Credential) private credentials;

    /// @dev credentialHash => verifier address => allowed
    mapping(bytes32 => mapping(address => bool)) private verifierAccess;

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error NotAuthorizedIssuer();
    error NotCredentialIssuer();
    error NotCredentialHolder();
    error CredentialAlreadyExists(bytes32 credentialHash);
    error CredentialNotFound(bytes32 credentialHash);
    error CredentialAlreadyRevoked(bytes32 credentialHash);
    error ZeroAddress();

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param registryAddress Address of the deployed RegistryContract.
    constructor(address registryAddress) {
        if (registryAddress == address(0)) revert ZeroAddress();
        registry = IRegistry(registryAddress);
    }

    // -------------------------------------------------------------------------
    // Issuer functions
    // -------------------------------------------------------------------------

    /// @inheritdoc ICredential
    function issueCredential(
        address holder,
        bytes32 credentialHash,
        string calldata metadataURI
    ) external override {
        if (!registry.isRegisteredIssuer(msg.sender)) revert NotAuthorizedIssuer();
        if (holder == address(0)) revert ZeroAddress();
        if (credentials[credentialHash].issuedAt != 0) revert CredentialAlreadyExists(credentialHash);

        credentials[credentialHash] = Credential({
            credentialHash: credentialHash,
            issuer: msg.sender,
            holder: holder,
            revoked: false,
            issuedAt: block.timestamp,
            metadataURI: metadataURI
        });

        emit CredentialIssued(credentialHash, msg.sender, holder, metadataURI);
    }

    /// @inheritdoc ICredential
    function revokeCredential(bytes32 credentialHash) external override {
        Credential storage cred = _requireExists(credentialHash);
        if (cred.issuer != msg.sender) revert NotCredentialIssuer();
        if (cred.revoked) revert CredentialAlreadyRevoked(credentialHash);

        cred.revoked = true;

        emit CredentialRevoked(credentialHash, msg.sender);
    }

    // -------------------------------------------------------------------------
    // Holder functions
    // -------------------------------------------------------------------------

    /// @inheritdoc ICredential
    function grantVerifierAccess(bytes32 credentialHash, address verifier) external override {
        Credential storage cred = _requireExists(credentialHash);
        if (cred.holder != msg.sender) revert NotCredentialHolder();
        if (verifier == address(0)) revert ZeroAddress();

        verifierAccess[credentialHash][verifier] = true;

        emit VerifierAccessGranted(credentialHash, msg.sender, verifier);
    }

    /// @inheritdoc ICredential
    function revokeVerifierAccess(bytes32 credentialHash, address verifier) external override {
        Credential storage cred = _requireExists(credentialHash);
        if (cred.holder != msg.sender) revert NotCredentialHolder();
        if (verifier == address(0)) revert ZeroAddress();

        verifierAccess[credentialHash][verifier] = false;

        emit VerifierAccessRevoked(credentialHash, msg.sender, verifier);
    }

    // -------------------------------------------------------------------------
    // View functions
    // -------------------------------------------------------------------------

    /// @inheritdoc ICredential
    function verifyCredential(bytes32 credentialHash)
        external
        view
        override
        returns (bool valid, string memory reason)
    {
        Credential storage cred = credentials[credentialHash];

        if (cred.issuedAt == 0) {
            return (false, "Credential not found");
        }

        if (!registry.isRegisteredIssuer(cred.issuer)) {
            return (false, "Issuer no longer registered");
        }

        if (cred.revoked) {
            return (false, "Credential revoked");
        }

        if (!verifierAccess[credentialHash][msg.sender]) {
            return (false, "Caller not in verifier allowlist");
        }

        return (true, "");
    }

    /// @inheritdoc ICredential
    function getMetadataURI(bytes32 credentialHash) external view override returns (string memory) {
        _requireExists(credentialHash);
        return credentials[credentialHash].metadataURI;
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    function _requireExists(bytes32 credentialHash) internal view returns (Credential storage) {
        Credential storage cred = credentials[credentialHash];
        if (cred.issuedAt == 0) revert CredentialNotFound(credentialHash);
        return cred;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ICredential
/// @notice Interface for issuing, revoking, and verifying credentials on-chain.
/// @dev Only keccak256 hashes are stored. Raw credential data must remain off-chain.
interface ICredential {
    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// @notice Emitted when a credential is issued.
    event CredentialIssued(
        bytes32 indexed credentialHash,
        address indexed issuer,
        address indexed holder
    );

    /// @notice Emitted when a credential is revoked by its issuer.
    event CredentialRevoked(
        bytes32 indexed credentialHash,
        address indexed issuer
    );

    /// @notice Emitted when a holder grants a verifier access to a credential.
    event VerifierAccessGranted(
        bytes32 indexed credentialHash,
        address indexed holder,
        address indexed verifier
    );

    /// @notice Emitted when a holder revokes a verifier's access to a credential.
    event VerifierAccessRevoked(
        bytes32 indexed credentialHash,
        address indexed holder,
        address indexed verifier
    );

    // -------------------------------------------------------------------------
    // Issuer functions
    // -------------------------------------------------------------------------

    /// @notice Issue a credential. Caller must be an authorized issuer.
    /// @param holder Address of the credential holder.
    /// @param credentialHash keccak256 hash of off-chain credential data.
    function issueCredential(address holder, bytes32 credentialHash) external;

    /// @notice Revoke a credential. Caller must be the original issuer.
    /// @param credentialHash Hash of the credential to revoke.
    function revokeCredential(bytes32 credentialHash) external;

    // -------------------------------------------------------------------------
    // Holder functions
    // -------------------------------------------------------------------------

    /// @notice Grant a verifier access to a credential. Caller must be the holder.
    /// @param credentialHash Hash of the credential.
    /// @param verifier Address to grant access to.
    function grantVerifierAccess(bytes32 credentialHash, address verifier) external;

    /// @notice Revoke a verifier's access to a credential. Caller must be the holder.
    /// @param credentialHash Hash of the credential.
    /// @param verifier Address to revoke access from.
    function revokeVerifierAccess(bytes32 credentialHash, address verifier) external;

    // -------------------------------------------------------------------------
    // View functions
    // -------------------------------------------------------------------------

    /// @notice Verify a credential. Caller is the verifier.
    /// @dev Checks four conditions in order:
    ///      1. Credential exists (hash known)
    ///      2. Original issuer is still a registered issuer
    ///      3. Credential has not been revoked
    ///      4. msg.sender is in the holder's verifier allowlist
    /// @param credentialHash Hash of the credential to verify.
    /// @return valid  True if all four conditions pass.
    /// @return reason Human-readable failure reason; empty string on success.
    function verifyCredential(bytes32 credentialHash) external view returns (bool valid, string memory reason);
}

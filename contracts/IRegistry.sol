// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IRegistry
/// @notice Interface for managing authorized credential issuers.
interface IRegistry {
    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// @notice Emitted when an issuer is registered.
    event IssuerAdded(address indexed issuer);

    /// @notice Emitted when an issuer's registration is revoked.
    event IssuerRemoved(address indexed issuer);

    /// @notice Emitted when a wallet applies to become an issuer.
    /// @param applicant   Address requesting issuer status.
    /// @param metadataURI "ipfs://CID" of the application (name, contact, doc).
    event IssuerRequested(address indexed applicant, string metadataURI);

    /// @notice Emitted when the owner rejects a pending issuer application.
    event IssuerRequestRejected(address indexed applicant, string reason);

    /// @notice Emitted when a student is registered.
    event StudentAdded(address indexed student);

    /// @notice Emitted when a student's registration is revoked.
    event StudentRemoved(address indexed student);

    /// @notice Emitted when a wallet applies to become a registered student.
    /// @param applicant   Address requesting student status.
    /// @param metadataURI "ipfs://CID" of the application (name, school, contact).
    event StudentRequested(address indexed applicant, string metadataURI);

    /// @notice Emitted when the owner rejects a pending student application.
    event StudentRequestRejected(address indexed applicant, string reason);

    /// @notice Emitted when the owner grants admin rights to an address.
    event AdminAdded(address indexed admin);

    /// @notice Emitted when the owner revokes an address's admin rights.
    event AdminRemoved(address indexed admin);

    // -------------------------------------------------------------------------
    // Functions
    // -------------------------------------------------------------------------

    /// @notice Grant admin rights to an address. Owner only.
    /// @dev Admins may approve/reject/register/revoke issuers and students, but
    ///      may NOT add or remove other admins (that stays owner-only).
    /// @param account Address to promote to admin.
    function addAdmin(address account) external;

    /// @notice Revoke an address's admin rights. Owner only.
    /// @dev The owner is always an admin and cannot be removed via this call.
    /// @param account Address to demote.
    function removeAdmin(address account) external;

    /// @notice Check whether an address has admin rights (owner counts as admin).
    /// @param account Address to query.
    /// @return True if the address is the owner or a granted admin.
    function isAdmin(address account) external view returns (bool);

    /// @notice Apply to become a registered issuer. Anyone may call.
    /// @param metadataURI "ipfs://CID" pointing to application metadata.
    function requestIssuer(string calldata metadataURI) external;

    /// @notice Reject a pending issuer application. Owner only.
    /// @param applicant Address whose pending request is rejected.
    /// @param reason    Human-readable rejection reason (shown to applicant).
    function rejectIssuerRequest(address applicant, string calldata reason) external;

    /// @notice Register an issuer address. Owner only.
    /// @param issuer Address to register.
    function registerIssuer(address issuer) external;

    /// @notice Revoke an issuer's registration. Owner only.
    /// @param issuer Address to deregister.
    function revokeIssuer(address issuer) external;

    /// @notice Check whether an address is a registered issuer.
    /// @param issuer Address to query.
    /// @return True if registered.
    function isRegisteredIssuer(address issuer) external view returns (bool);

    /// @notice Apply to become a registered student. Anyone may call.
    /// @param metadataURI "ipfs://CID" pointing to application metadata.
    function requestStudent(string calldata metadataURI) external;

    /// @notice Reject a pending student application. Owner only.
    /// @param applicant Address whose pending request is rejected.
    /// @param reason    Human-readable rejection reason (shown to applicant).
    function rejectStudentRequest(address applicant, string calldata reason) external;

    /// @notice Register a student address. Owner only.
    /// @param student Address to register.
    function registerStudent(address student) external;

    /// @notice Revoke a student's registration. Owner only.
    /// @param student Address to deregister.
    function revokeStudent(address student) external;

    /// @notice Check whether an address is a registered student.
    /// @param student Address to query.
    /// @return True if registered.
    function isRegisteredStudent(address student) external view returns (bool);
}

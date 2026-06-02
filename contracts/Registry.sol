// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./IRegistry.sol";

/// @title RegistryContract
/// @notice Manages the set of authorized credential issuers.
/// @dev Ownership managed by OpenZeppelin Ownable (v5). Only the owner can
///      register or revoke issuers. Ownership is transferable via OZ's
///      `transferOwnership` and `renounceOwnership`.
contract RegistryContract is IRegistry, Ownable {
    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    mapping(address => bool) private _registeredIssuers;

    /// @notice Lifecycle of a self-serve issuer application.
    /// @dev Approved status is implied by `_registeredIssuers` — only the
    ///      Pending/Rejected states are tracked here.
    enum RequestStatus { None, Pending, Rejected }

    /// @notice Application status per applicant address.
    mapping(address => RequestStatus) public issuerRequestStatus;

    mapping(address => bool) private _registeredStudents;

    /// @notice Student application status per applicant address.
    /// @dev Mirrors `issuerRequestStatus`; Approved is implied by `_registeredStudents`.
    mapping(address => RequestStatus) public studentRequestStatus;

    /// @notice Extra admin addresses beyond the owner.
    /// @dev The owner is always an admin (see `isAdmin`) and is NOT stored here.
    ///      Admins may approve/reject/register/revoke issuers and students, but
    ///      only the owner may add or remove admins.
    mapping(address => bool) private _admins;

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error ZeroAddress();
    error AlreadyRegistered(address issuer);
    error NotRegistered(address issuer);
    error RequestPending();
    error NoPendingRequest();
    error NotAdmin();
    error AlreadyAdmin(address account);
    error AdminNotFound(address account);

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    /// @notice Restricts to the owner or any granted admin.
    modifier onlyAdmin() {
        if (msg.sender != owner() && !_admins[msg.sender]) revert NotAdmin();
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param initialOwner  Address that will own the registry (passed to OZ Ownable v5).
    /// @param initialAdmins Extra admin addresses granted at deploy time. The owner
    ///        is always an admin and need not be listed; zero/owner/duplicate
    ///        entries are skipped.
    constructor(address initialOwner, address[] memory initialAdmins) Ownable(initialOwner) {
        for (uint256 i = 0; i < initialAdmins.length; i++) {
            address a = initialAdmins[i];
            if (a == address(0) || a == initialOwner || _admins[a]) continue;
            _admins[a] = true;
            emit AdminAdded(a);
        }
    }

    // -------------------------------------------------------------------------
    // Admin management (owner only)
    // -------------------------------------------------------------------------

    /// @inheritdoc IRegistry
    function addAdmin(address account) external override onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        if (account == owner() || _admins[account]) revert AlreadyAdmin(account);
        _admins[account] = true;
        emit AdminAdded(account);
    }

    /// @inheritdoc IRegistry
    function removeAdmin(address account) external override onlyOwner {
        if (!_admins[account]) revert AdminNotFound(account);
        _admins[account] = false;
        emit AdminRemoved(account);
    }

    /// @inheritdoc IRegistry
    function isAdmin(address account) external view override returns (bool) {
        return account == owner() || _admins[account];
    }

    // -------------------------------------------------------------------------
    // Application functions
    // -------------------------------------------------------------------------

    /// @inheritdoc IRegistry
    function requestIssuer(string calldata metadataURI) external override {
        if (_registeredIssuers[msg.sender]) revert AlreadyRegistered(msg.sender);
        if (issuerRequestStatus[msg.sender] == RequestStatus.Pending) revert RequestPending();
        issuerRequestStatus[msg.sender] = RequestStatus.Pending;
        emit IssuerRequested(msg.sender, metadataURI);
    }

    /// @inheritdoc IRegistry
    function rejectIssuerRequest(address applicant, string calldata reason) external override onlyAdmin {
        if (issuerRequestStatus[applicant] != RequestStatus.Pending) revert NoPendingRequest();
        issuerRequestStatus[applicant] = RequestStatus.Rejected;
        emit IssuerRequestRejected(applicant, reason);
    }

    /// @inheritdoc IRegistry
    function requestStudent(string calldata metadataURI) external override {
        if (_registeredStudents[msg.sender]) revert AlreadyRegistered(msg.sender);
        if (studentRequestStatus[msg.sender] == RequestStatus.Pending) revert RequestPending();
        studentRequestStatus[msg.sender] = RequestStatus.Pending;
        emit StudentRequested(msg.sender, metadataURI);
    }

    /// @inheritdoc IRegistry
    function rejectStudentRequest(address applicant, string calldata reason) external override onlyAdmin {
        if (studentRequestStatus[applicant] != RequestStatus.Pending) revert NoPendingRequest();
        studentRequestStatus[applicant] = RequestStatus.Rejected;
        emit StudentRequestRejected(applicant, reason);
    }

    // -------------------------------------------------------------------------
    // Owner functions
    // -------------------------------------------------------------------------

    /// @inheritdoc IRegistry
    function registerIssuer(address issuer) external override onlyAdmin {
        if (issuer == address(0)) revert ZeroAddress();
        if (_registeredIssuers[issuer]) revert AlreadyRegistered(issuer);
        _registeredIssuers[issuer] = true;
        issuerRequestStatus[issuer] = RequestStatus.None; // clear any pending/rejected application
        emit IssuerAdded(issuer);
    }

    /// @inheritdoc IRegistry
    function revokeIssuer(address issuer) external override onlyAdmin {
        if (!_registeredIssuers[issuer]) revert NotRegistered(issuer);
        _registeredIssuers[issuer] = false;
        emit IssuerRemoved(issuer);
    }

    /// @inheritdoc IRegistry
    function registerStudent(address student) external override onlyAdmin {
        if (student == address(0)) revert ZeroAddress();
        if (_registeredStudents[student]) revert AlreadyRegistered(student);
        _registeredStudents[student] = true;
        studentRequestStatus[student] = RequestStatus.None; // clear any pending/rejected application
        emit StudentAdded(student);
    }

    /// @inheritdoc IRegistry
    function revokeStudent(address student) external override onlyAdmin {
        if (!_registeredStudents[student]) revert NotRegistered(student);
        _registeredStudents[student] = false;
        emit StudentRemoved(student);
    }

    // -------------------------------------------------------------------------
    // View functions
    // -------------------------------------------------------------------------

    /// @inheritdoc IRegistry
    function isRegisteredIssuer(address issuer) external view override returns (bool) {
        return _registeredIssuers[issuer];
    }

    /// @inheritdoc IRegistry
    function isRegisteredStudent(address student) external view override returns (bool) {
        return _registeredStudents[student];
    }
}

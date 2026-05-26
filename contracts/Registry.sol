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

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error ZeroAddress();
    error AlreadyRegistered(address issuer);
    error NotRegistered(address issuer);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param initialOwner Address that will own the registry (passed to OZ Ownable v5).
    constructor(address initialOwner) Ownable(initialOwner) {}

    // -------------------------------------------------------------------------
    // Owner functions
    // -------------------------------------------------------------------------

    /// @inheritdoc IRegistry
    function registerIssuer(address issuer) external override onlyOwner {
        if (issuer == address(0)) revert ZeroAddress();
        if (_registeredIssuers[issuer]) revert AlreadyRegistered(issuer);
        _registeredIssuers[issuer] = true;
        emit IssuerAdded(issuer);
    }

    /// @inheritdoc IRegistry
    function revokeIssuer(address issuer) external override onlyOwner {
        if (!_registeredIssuers[issuer]) revert NotRegistered(issuer);
        _registeredIssuers[issuer] = false;
        emit IssuerRemoved(issuer);
    }

    // -------------------------------------------------------------------------
    // View functions
    // -------------------------------------------------------------------------

    /// @inheritdoc IRegistry
    function isRegisteredIssuer(address issuer) external view override returns (bool) {
        return _registeredIssuers[issuer];
    }
}

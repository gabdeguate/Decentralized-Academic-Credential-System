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

    // -------------------------------------------------------------------------
    // Functions
    // -------------------------------------------------------------------------

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
}

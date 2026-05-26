# Contracts

## Files
- RegistryContract.sol — manages authorized issuers (onlyOwner write functions)
- CredentialContract.sol — issues, revokes, and verifies credentials (takes Registry address in constructor)

## Rules
- Only registered issuers (checked via Registry) can call issueCredential and revokeCredential
- Only the credential holder (msg.sender == studentAddress) can call grantAccess and revokeAccess
- verifyCredential is a view function — no state changes, no gas cost
- Revocation is permanent — no un-revoke
- Raw credential data never stored on-chain — keccak256 hash only
- All state changes must emit a timestamped event

## Modifiers to use
- onlyOwner (from OpenZeppelin Ownable) for Registry write functions
- onlyRegisteredIssuer for CredentialContract write functions
- onlyHolder for grantAccess and revokeAccess

## Events required
- IssuerRegistered(address indexed issuer, uint256 timestamp)
- IssuerRevoked(address indexed issuer, uint256 timestamp)
- CredentialIssued(address indexed student, uint256 indexed credentialId, address indexed issuer, bytes32 credentialHash, uint256 timestamp)
- CredentialRevoked(address indexed student, uint256 indexed credentialId, address indexed issuer, uint256 timestamp)
- AccessGranted(uint256 indexed credentialId, address indexed verifier)
- AccessRevoked(uint256 indexed credentialId, address indexed verifier)

## Gas targets
- issueCredential: under 80,000 gas
- verifyCredential: 0 (view call)
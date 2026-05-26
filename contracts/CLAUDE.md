# Contracts

## Files
- `IRegistry.sol` — interface for RegistryContract
- `ICredential.sol` — interface for CredentialContract
- `Registry.sol` — RegistryContract: manages authorized issuers (onlyOwner write functions)
- `Credential.sol` — CredentialContract: issues, revokes, verifies credentials; takes Registry address in constructor

## Actual Function Signatures

### RegistryContract
```solidity
function registerIssuer(address issuer) external onlyOwner
function revokeIssuer(address issuer) external onlyOwner
function isRegisteredIssuer(address issuer) external view returns (bool)
```

### CredentialContract
```solidity
function issueCredential(address holder, bytes32 credentialHash, string calldata metadataURI) external
function revokeCredential(bytes32 credentialHash) external
function grantVerifierAccess(bytes32 credentialHash, address verifier) external
function revokeVerifierAccess(bytes32 credentialHash, address verifier) external
function verifyCredential(bytes32 credentialHash) external view returns (bool valid, string memory reason)
function getMetadataURI(bytes32 credentialHash) external view returns (string memory)
```

## Rules
- Only owner (OZ Ownable v5) can `registerIssuer` / `revokeIssuer`
- Only registered issuers (checked via Registry) can call `issueCredential`
- Only the original issuer of a credential can call `revokeCredential`
- Only the credential holder (`msg.sender == credential.holder`) can call `grantVerifierAccess` / `revokeVerifierAccess`
- `verifyCredential` — `msg.sender` IS the verifier being checked. No verifier param.
- Revocation is permanent — no un-revoke
- Raw credential data never stored on-chain — keccak256 hash only
- `metadataURI` stores "ipfs://CID" for off-chain document
- `issuedAt == 0` used as non-existence sentinel
- All state changes must emit an event

## Actual Events

### RegistryContract
```solidity
event IssuerAdded(address indexed issuer)
event IssuerRemoved(address indexed issuer)
```

### CredentialContract
```solidity
event CredentialIssued(bytes32 indexed credentialHash, address indexed issuer, address indexed holder, string metadataURI)
event CredentialRevoked(bytes32 indexed credentialHash, address indexed issuer)
event VerifierAccessGranted(bytes32 indexed credentialHash, address indexed holder, address indexed verifier)
event VerifierAccessRevoked(bytes32 indexed credentialHash, address indexed holder, address indexed verifier)
```

## Custom Errors (with 4-byte selectors)

### RegistryContract
| Error | Selector |
|---|---|
| `ZeroAddress()` | `0xd92e233d` |
| `AlreadyRegistered(address)` | `0x45ed80e9` |
| `NotRegistered(address)` | `0xbfc6c337` |
| `OwnableUnauthorizedAccount(address)` (OZ) | `0x118cdaa7` |

### CredentialContract
| Error | Selector |
|---|---|
| `ZeroAddress()` | `0xd92e233d` |
| `NotAuthorizedIssuer()` | `0x3557a788` |
| `NotCredentialIssuer()` | `0x6541186c` |
| `NotCredentialHolder()` | `0x7575188f` |
| `CredentialAlreadyExists(bytes32)` | `0x87dbb506` |
| `CredentialNotFound(bytes32)` | `0x0d99a0d1` |
| `CredentialAlreadyRevoked(bytes32)` | `0xaac64f45` |

## Struct
```solidity
struct Credential {
    bytes32 credentialHash;
    address issuer;
    address holder;
    bool revoked;
    uint256 issuedAt;    // 0 = does not exist
    string metadataURI;  // "ipfs://CID" or ""
}
```

## verifyCredential Condition Order
Checked in order — first failure wins:
1. `cred.issuedAt != 0` → else `(false, "Credential not found")`
2. `registry.isRegisteredIssuer(cred.issuer)` → else `(false, "Issuer no longer registered")`
3. `!cred.revoked` → else `(false, "Credential revoked")`
4. `verifierAccess[credentialHash][msg.sender]` → else `(false, "Caller not in verifier allowlist")`
5. All pass → `(true, "")`

## OpenZeppelin
- Ownable v5: constructor requires `initialOwner` address. Non-owner error = `OwnableUnauthorizedAccount(address)`.
- Import: `@openzeppelin/contracts/access/Ownable.sol`

## Gas targets
- `issueCredential`: under 80,000 gas
- `verifyCredential`: 0 (view call)

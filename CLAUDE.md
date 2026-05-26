# DACS — Decentralized Academic Credential System

Ethereum Sepolia. Hardhat + Ethers.js v6. Two-contract system: registry + credentials.

## Project Structure

```
dacs/
├── contracts/
│   ├── Registry.sol        # RegistryContract — authorized issuer management
│   └── Credential.sol      # CredentialContract — issue/revoke/verify credentials
├── test/                   # Hardhat tests (Ethers.js v6)
├── frontend/               # Frontend (reads chain state, calls contracts)
├── scripts/                # Deploy scripts
├── hardhat.config.js
└── package.json
```

## Commands

```bash
# Install
npm install

# Compile
npx hardhat compile

# Test (all)
npx hardhat test

# Test (single file)
npx hardhat test test/Registry.test.js
npx hardhat test test/Credential.test.js

# Coverage
npx hardhat coverage

# Deploy to Sepolia
npx hardhat run scripts/deploy.js --network sepolia

# Verify on Etherscan
npx hardhat verify --network sepolia <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>

# Local node
npx hardhat node

# Deploy to localhost
npx hardhat run scripts/deploy.js --network localhost
```

## Environment

`.env` required (never commit):
```
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/<KEY>
PRIVATE_KEY=0x...
ETHERSCAN_API_KEY=...
```

## Contracts

### Registry.sol — `RegistryContract`

Manages authorized issuers. Owner-controlled.

**Storage:**
- `address owner` — deployer, set in constructor
- `mapping(address => bool) authorizedIssuers`

**Functions:**
- `addIssuer(address)` — owner only; emits `IssuerAdded`
- `removeIssuer(address)` — owner only; emits `IssuerRemoved`
- `isAuthorized(address) view returns (bool)`

**Events:**
- `IssuerAdded(address indexed issuer)`
- `IssuerRemoved(address indexed issuer)`

### Credential.sol — `CredentialContract`

Issues, revokes, verifies credentials via keccak256 hashes. References `RegistryContract`.

**Storage:**
```
struct Credential {
    bytes32 credentialHash;   // keccak256 of off-chain data
    address issuer;
    address holder;
    bool revoked;
    uint256 issuedAt;
}

mapping(bytes32 => Credential) credentials
mapping(bytes32 => mapping(address => bool)) verifierAccess  // hash => verifier => allowed
```

**Functions:**
- `issueCredential(address holder, bytes32 credentialHash)` — authorized issuer only; emits `CredentialIssued`
- `revokeCredential(bytes32 credentialHash)` — issuer of that credential only; emits `CredentialRevoked`
- `grantVerifierAccess(bytes32 credentialHash, address verifier)` — holder only; emits `VerifierAccessGranted`
- `revokeVerifierAccess(bytes32 credentialHash, address verifier)` — holder only; emits `VerifierAccessRevoked`
- `verifyCredential(bytes32 credentialHash, address verifier) view returns (bool)` — returns true if credential exists, not revoked, verifier has access

**Events:**
- `CredentialIssued(bytes32 indexed credentialHash, address indexed issuer, address indexed holder)`
- `CredentialRevoked(bytes32 indexed credentialHash, address indexed issuer)`
- `VerifierAccessGranted(bytes32 indexed credentialHash, address indexed holder, address indexed verifier)`
- `VerifierAccessRevoked(bytes32 indexed credentialHash, address indexed holder, address indexed verifier)`

## Key Rules

### Access Control
- Only authorized issuers (per RegistryContract) can call `issueCredential`
- Only the original issuer of a credential can call `revokeCredential`
- Only the credential holder can call `grantVerifierAccess` / `revokeVerifierAccess`
- `verifyCredential` is `view` — no state changes, no gas for callers

### Data Privacy
- **Raw credential data never stored on-chain**
- Only `keccak256` hash stored; off-chain data lives in IPFS or issuer backend
- Hash must be computed off-chain and passed in; contract does not hash inputs

### State Changes
- Every state-changing function must emit an event
- No silent state mutations

### Ethers.js v6 Patterns
```js
// v6: BigInt not BigNumber
const tx = await contract.issueCredential(holderAddr, credHash);
await tx.wait();

// v6: getAddress not utils.getAddress
const addr = ethers.getAddress(rawAddr);

// v6: provider from hardhat
const [owner, issuer, holder] = await ethers.getSigners();

// v6: parseUnits
const amount = ethers.parseEther("1.0");

// v6: Contract factory
const Factory = await ethers.getContractFactory("CredentialContract");
const contract = await Factory.deploy(registryAddress);
await contract.waitForDeployment();
const address = await contract.getAddress();  // not .address
```

## Testing Checklist

### RegistryContract
- [ ] Owner can add issuer → `IssuerAdded` emitted
- [ ] Owner can remove issuer → `IssuerRemoved` emitted
- [ ] Non-owner cannot add/remove issuer → reverts
- [ ] `isAuthorized` returns correct state after add/remove

### CredentialContract
- [ ] Authorized issuer can issue credential → `CredentialIssued` emitted
- [ ] Unauthorized address cannot issue → reverts
- [ ] Issuer can revoke own credential → `CredentialRevoked` emitted
- [ ] Non-issuer cannot revoke → reverts
- [ ] Holder can grant verifier access → `VerifierAccessGranted` emitted
- [ ] Holder can revoke verifier access → `VerifierAccessRevoked` emitted
- [ ] Non-holder cannot grant/revoke access → reverts
- [ ] `verifyCredential` returns true for valid credential + authorized verifier
- [ ] `verifyCredential` returns false for revoked credential
- [ ] `verifyCredential` returns false for verifier without access
- [ ] `verifyCredential` is view-only (no state change)

## Sepolia Config (hardhat.config.js)

```js
networks: {
  sepolia: {
    url: process.env.SEPOLIA_RPC_URL,
    accounts: [process.env.PRIVATE_KEY],
    chainId: 11155111,
  }
},
etherscan: {
  apiKey: process.env.ETHERSCAN_API_KEY,
}
```

## Deployment Order

1. Deploy `RegistryContract` → save address
2. Deploy `CredentialContract(registryAddress)` → save address
3. Call `addIssuer(issuerAddress)` on Registry
4. Verify both contracts on Etherscan

## Frontend Notes

- Use `ethers.Contract` with ABI + provider (read) or signer (write)
- `verifyCredential` → call, not send (view function)
- Listen for events via `contract.on("CredentialIssued", handler)`
- Compute `credentialHash = ethers.keccak256(ethers.toUtf8Bytes(rawData))` client-side

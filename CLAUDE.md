# DACS — Decentralized Academic Credential System

Ethereum Sepolia. Hardhat + Ethers.js v6. Two-contract system: registry + credentials.

## Project Structure

```
dacs/
├── contracts/
│   ├── IRegistry.sol       # Interface for RegistryContract
│   ├── ICredential.sol     # Interface for CredentialContract
│   ├── Registry.sol        # RegistryContract — authorized issuer management
│   └── Credential.sol      # CredentialContract — issue/revoke/verify credentials
├── ignition/
│   └── modules/DACS.ts     # Hardhat Ignition deployment module
├── test/
│   ├── Registry.test.ts
│   ├── Credential.test.ts
│   └── Credential.integration.test.ts
├── frontend/               # Vite + TypeScript frontend
├── hardhat.config.ts
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
npx hardhat test test/Registry.test.ts
npx hardhat test test/Credential.test.ts

# Coverage
npx hardhat coverage

# Local node (Terminal 1)
npx hardhat node

# Deploy to localhost (Terminal 2)
npx hardhat ignition deploy ignition/modules/DACS.ts --network localhost

# Deploy to Sepolia
npm run deploy:sepolia
# expands to: hardhat ignition deploy ignition/modules/DACS.ts --network sepolia --verify

# Verify on Etherscan (if skipped during deploy)
./node_modules/.bin/hardhat ignition verify chain-11155111 --include-unrelated-contracts
```

## Environment

Root `.env` required (never commit):
```
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<KEY>
PRIVATE_KEY=0x...   # 0x + 64 hex chars
ETHERSCAN_API_KEY=...
```

Frontend `frontend/.env` required (never commit):
```
VITE_PINATA_API_KEY=...
VITE_PINATA_SECRET_API_KEY=...
VITE_REGISTRY_ADDRESS=0x...
VITE_CREDENTIAL_ADDRESS=0x...
```

## Deployed Addresses (Sepolia)

```json
{
  "DACSModule#RegistryContract":  "0xc65AeAb4dB37A7cB1025cC9cC2c6231de7c65A9D",
  "DACSModule#CredentialContract": "0x469Be3C83b7ec56d43dc7e468BcDf2815B13C52c"
}
```

Etherscan:
- Registry:   https://sepolia.etherscan.io/address/0xc65AeAb4dB37A7cB1025cC9cC2c6231de7c65A9D
- Credential: https://sepolia.etherscan.io/address/0x469Be3C83b7ec56d43dc7e468BcDf2815B13C52c

## Contracts

### Registry.sol — `RegistryContract`

Manages authorized issuers. Owner-controlled (OZ Ownable v5).

**Storage:**
- `mapping(address => bool) private _registeredIssuers`

**Functions:**
- `registerIssuer(address issuer)` — onlyOwner; reverts `ZeroAddress`, `AlreadyRegistered(issuer)`; emits `IssuerAdded`
- `revokeIssuer(address issuer)` — onlyOwner; reverts `NotRegistered(issuer)`; emits `IssuerRemoved`
- `isRegisteredIssuer(address issuer) view returns (bool)`

**Events:**
- `IssuerAdded(address indexed issuer)`
- `IssuerRemoved(address indexed issuer)`

**Custom Errors:**
- `ZeroAddress()`
- `AlreadyRegistered(address issuer)`  — selector `0x45ed80e9`
- `NotRegistered(address issuer)`

### Credential.sol — `CredentialContract`

Issues, revokes, verifies credentials via keccak256 hashes. Stores IPFS metadataURI.

**Storage:**
```solidity
struct Credential {
    bytes32 credentialHash;  // keccak256 of off-chain data
    address issuer;
    address holder;
    bool revoked;
    uint256 issuedAt;        // 0 = does not exist
    string metadataURI;      // "ipfs://CID" or ""
}

mapping(bytes32 => Credential) private credentials;
mapping(bytes32 => mapping(address => bool)) private verifierAccess;
IRegistry public immutable registry;
```

**Functions:**
- `issueCredential(address holder, bytes32 credentialHash, string calldata metadataURI)` — registered issuer only; emits `CredentialIssued`
- `revokeCredential(bytes32 credentialHash)` — original issuer only; emits `CredentialRevoked`
- `grantVerifierAccess(bytes32 credentialHash, address verifier)` — holder only; emits `VerifierAccessGranted`
- `revokeVerifierAccess(bytes32 credentialHash, address verifier)` — holder only; emits `VerifierAccessRevoked`
- `verifyCredential(bytes32 credentialHash) view returns (bool valid, string reason)` — `msg.sender` IS the verifier; zero gas
- `getMetadataURI(bytes32 credentialHash) view returns (string)` — reverts `CredentialNotFound` if not exists

**Events:**
- `CredentialIssued(bytes32 indexed credentialHash, address indexed issuer, address indexed holder, string metadataURI)`
- `CredentialRevoked(bytes32 indexed credentialHash, address indexed issuer)`
- `VerifierAccessGranted(bytes32 indexed credentialHash, address indexed holder, address indexed verifier)`
- `VerifierAccessRevoked(bytes32 indexed credentialHash, address indexed holder, address indexed verifier)`

**Custom Errors (selectors):**
- `ZeroAddress()`                              — `0xd92e233d`
- `NotAuthorizedIssuer()`                      — `0x3557a788`
- `NotCredentialIssuer()`                      — `0x6541186c`
- `NotCredentialHolder()`                      — `0x7575188f`
- `CredentialAlreadyExists(bytes32)`           — `0x87dbb506`
- `CredentialNotFound(bytes32)`                — `0x0d99a0d1`
- `CredentialAlreadyRevoked(bytes32)`          — `0xaac64f45`

## Key Rules

### Access Control
- Only `owner` (deployer) can call `registerIssuer` / `revokeIssuer`
- Only registered issuers can call `issueCredential`
- Only the original issuer of a credential can call `revokeCredential`
- Only the credential holder can call `grantVerifierAccess` / `revokeVerifierAccess`
- `verifyCredential` is `view` — no gas; `msg.sender` is the verifier being checked

### Data Privacy
- **Raw credential data never stored on-chain**
- Only `keccak256` hash stored on-chain; diploma PDF uploaded to IPFS via Pinata
- `metadataURI = "ipfs://CID"` stored on-chain; fetched via Pinata gateway for download
- Hash computed off-chain with `solidityPackedKeccak256(["address","string","string"], [studentAddr, degreeType, gradDate])`

### State Changes
- Every state-changing function must emit an event
- No silent state mutations

### Ignition Redeployment
If contracts change (bytecode mismatch error IGN723):
```bash
rm -rf ignition/deployments/chain-11155111
npm run deploy:sepolia
```
Then update `frontend/.env` with new addresses and restart dev server.

### Ethers.js v6 Patterns
```js
// v6: BigInt not BigNumber
const tx = await contract.issueCredential(holderAddr, credHash, "ipfs://CID");
await tx.wait();

// v6: BrowserProvider (frontend)
const provider = new ethers.BrowserProvider(window.ethereum);
const signer = await provider.getSigner();

// v6: solidityPackedKeccak256 for hash
const hash = ethers.solidityPackedKeccak256(
  ["address", "string", "string"],
  [studentAddr, degreeType, gradDate]
);

// v6: isAddress
ethers.isAddress(addr);

// v6: Contract factory
const Factory = await ethers.getContractFactory("CredentialContract");
const contract = await Factory.deploy(registryAddress);
await contract.waitForDeployment();
const address = await contract.getAddress();  // not .address
```

## Testing

- `test/Registry.test.ts` — 17 unit tests
- `test/Credential.test.ts` — 48 unit tests (includes metadataURI tests)
- `test/Credential.integration.test.ts` — 13 integration tests

All tests: `npx hardhat test` → should show 78 passing.

## Hardhat Config (hardhat.config.ts)

```ts
networks: {
  sepolia: {
    url: process.env.SEPOLIA_RPC_URL,
    accounts: [process.env.PRIVATE_KEY],
    chainId: 11155111,
  },
  localhost: {
    url: "http://127.0.0.1:8545",
    chainId: 31337,
  }
},
etherscan: {
  apiKey: ETHERSCAN_API_KEY,  // string, NOT { sepolia: KEY } — V2 API
}
```

## Frontend (frontend/)

Stack: Vite 5 + TypeScript 5 + Ethers.js v6. MetaMask wallet.

```bash
cd frontend
npm install
npm run dev    # localhost:5173
npm run build  # dist/
```

Config: `frontend/src/config.ts` — addresses, ABIs (including all custom errors for decoding).

Hash function: `solidityPackedKeccak256(["address","string","string"], [studentAddr, degreeType, gradDate])`

IPFS: `frontend/src/utils/ipfs.ts` — uploads PDF to Pinata, returns CID.

All UI functions exposed on `window.*` for inline `onclick` handlers.

## Demo Flow

**Sepolia:** issuer already registered (`0x9E492DfE631f4A5732771574848292f0b242eE53`). Use different credential inputs each session to avoid `CredentialAlreadyExists`.

**Local (clean reset):**
1. `npx hardhat node` (Terminal 1)
2. `npx hardhat ignition deploy ignition/modules/DACS.ts --network localhost` (Terminal 2)
3. Update `frontend/.env` with localhost addresses
4. MetaMask → Add network: `http://127.0.0.1:8545`, chainId `31337`
5. Import Hardhat Account #0 private key: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
6. Kill node → restart = full reset

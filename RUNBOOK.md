# DACS Runbook

Step-by-step operational guide: install, compile, test, deploy, verify, interact.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Install Dependencies](#install-dependencies)
3. [Configure Environment](#configure-environment)
4. [Compile Contracts](#compile-contracts)
5. [Run Tests](#run-tests)
6. [Deploy to a Local Node](#deploy-to-a-local-node)
7. [Deploy to Sepolia](#deploy-to-sepolia)
8. [Verify on Etherscan](#verify-on-etherscan)
9. [Start the Frontend](#start-the-frontend)
10. [Interact with Deployed Contracts](#interact-with-deployed-contracts)
11. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Install these before doing anything else:

| Tool | Minimum version | Install |
|---|---|---|
| Node.js | 18.x | [nodejs.org](https://nodejs.org) or `nvm install 18` |
| npm | 8.x (ships with Node 18) | — |
| Git | any | — |

Check your versions:

```bash
node --version   # must be >= 18.0.0
npm --version
```

You will also need:

- A **Sepolia wallet private key** with test ETH (get from [sepoliafaucet.com](https://sepoliafaucet.com) or [alchemy.com/faucets/ethereum-sepolia](https://www.alchemy.com/faucets/ethereum-sepolia))
- A **Sepolia RPC URL** from [Alchemy](https://alchemy.com) or [Infura](https://infura.io) (free tier works)
- An **Etherscan API key** from [etherscan.io/myapikey](https://etherscan.io/myapikey) (free, required for verification)

---

## Install Dependencies

```bash
# Clone the repo (or navigate to your existing directory)
cd /path/to/dacs

# Install all npm packages
npm install
```

This installs Hardhat, Ethers.js v6, OpenZeppelin Contracts, TypeChain, and all tooling. Takes 30–60 seconds.

> **Do not run `npx hardhat` directly** — it will download the latest Hardhat version (v3) instead of using the local v2 install. Always use `npm run <script>` or `./node_modules/.bin/hardhat`.

---

## Configure Environment

Copy the example file and fill in your secrets:

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# Your deployer wallet's private key.
# Must be: 0x followed by exactly 64 hex characters (32 bytes).
# Example format: 0x0000000000000000000000000000000000000000000000000000000000000001
# Get a real key from MetaMask: Account Details → Export Private Key
PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE

# Sepolia RPC endpoint from Alchemy or Infura.
# Alchemy: https://dashboard.alchemy.com → Create App → View Key → HTTPS
# Infura:  https://infura.io/dashboard → Create Project → Endpoints → Sepolia
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY

# Etherscan API key for contract verification.
# Get from: https://etherscan.io/myapikey (free registration)
# Must be the raw key string, NOT a URL.
ETHERSCAN_API_KEY=YOUR_ETHERSCAN_API_KEY
```

**Critical rules for `.env`:**

1. **No spaces around `=`** — `KEY=value` is correct; `KEY = value` or `KEY= "value"` will break parsing.
2. **No quotes** around values — `PRIVATE_KEY=0xabc` is correct; `PRIVATE_KEY='0xabc'` is wrong.
3. **`PRIVATE_KEY` must start with `0x`** and be exactly 66 characters total (`0x` + 64 hex digits).
4. **Never commit `.env`** — it is in `.gitignore`. If you accidentally commit it, rotate the key immediately.

---

## Compile Contracts

```bash
npm run compile
```

This runs `hardhat compile`, which:
1. Compiles all `.sol` files in `contracts/` with Solidity 0.8.24
2. Writes ABI + bytecode to `artifacts/`
3. Generates TypeScript type bindings in `typechain-types/`

Recompile after any change to a `.sol` file. Hardhat caches clean output and only recompiles changed files.

```
# Expected output:
Compiling 5 files with Solc 0.8.24
Compilation finished successfully
```

---

## Run Tests

### Run all tests

```bash
npm test
```

Runs all 60 tests across three files:
- `test/Registry.test.ts` — 17 unit tests
- `test/Credential.test.ts` — 32 unit tests
- `test/Credential.integration.test.ts` — 11 integration tests (full lifecycle)

### Run a single test file

```bash
# Registry tests only
./node_modules/.bin/hardhat test test/Registry.test.ts

# Credential unit tests only
./node_modules/.bin/hardhat test test/Credential.test.ts

# Integration tests only
./node_modules/.bin/hardhat test test/Credential.integration.test.ts
```

### Run coverage

```bash
npm run test:coverage
```

Generates an Istanbul/nyc coverage report in `coverage/`. Open `coverage/index.html` in a browser to see line-by-line results.

### What the tests cover

**Registry unit tests (`Registry.test.ts`)**
- Deployer is set as owner
- Initial state has no registered issuers
- Owner can register an issuer → `IssuerAdded` emitted
- Non-owner registration reverts `OwnableUnauthorizedAccount`
- Zero address reverts `ZeroAddress`
- Duplicate registration reverts `AlreadyRegistered`
- Multiple distinct issuers can be registered
- Owner can revoke → `IssuerRemoved` emitted
- Non-owner revocation reverts
- Revoking unregistered address reverts `NotRegistered`
- Double-revoke reverts
- `isRegisteredIssuer` reflects state after add/remove/re-add

**Credential unit tests (`Credential.test.ts`)**
- Stores registry address; reverts on zero registry address
- Registered issuer can issue → `CredentialIssued` emitted
- Unregistered issuer reverts `NotAuthorizedIssuer`
- Zero holder address reverts `ZeroAddress`
- Duplicate hash reverts `CredentialAlreadyExists`
- Issuer deregistered after issue → cannot issue again
- Original issuer can revoke → `CredentialRevoked` emitted
- Non-issuer reverts `NotCredentialIssuer`; holder also cannot revoke
- Non-existent credential reverts `CredentialNotFound`
- Double-revoke reverts `CredentialAlreadyRevoked`
- Holder can grant verifier → `VerifierAccessGranted` emitted
- Non-holder reverts `NotCredentialHolder`
- Zero verifier address reverts `ZeroAddress`
- Holder can revoke verifier → `VerifierAccessRevoked` emitted
- Revoking one verifier does not affect others
- All four `verifyCredential` conditions + ordering test

**Integration tests (`Credential.integration.test.ts`)**
- Sequential stateful flow — tests build on each other
- Full path: register → issue → grant → verify(true) → revoke → verify(false) → deregister issuer → verify(false, "Issuer no longer registered")

---

## Deploy to a Local Node

Useful for rapid iteration without spending testnet ETH.

**Terminal 1 — start local node:**

```bash
npm run node
```

This starts a Hardhat in-process Ethereum node at `http://127.0.0.1:8545`. It prints 20 funded test accounts (each with 10000 ETH). Leave this terminal running.

**Terminal 2 — deploy:**

```bash
npm run deploy:local
```

Output will show both deployed contract addresses. The deployment is **not** persisted between node restarts — restarting `npm run node` wipes all state.

---

## Deploy to Sepolia

Make sure:
1. `.env` is configured (see [Configure Environment](#configure-environment))
2. Your deployer wallet has Sepolia ETH (get from a faucet)
3. Contracts compile cleanly (`npm run compile`)

```bash
npm run deploy:sepolia
```

This runs:
```
hardhat ignition deploy ignition/modules/DACS.ts --network sepolia --verify
```

**What happens:**
1. Ignition reads `ignition/modules/DACS.ts`
2. Deploys `RegistryContract` with your wallet address as `initialOwner`
3. Deploys `CredentialContract` with the just-deployed Registry address
4. Attempts Etherscan verification for both contracts
5. Writes results to `ignition/deployments/chain-11155111/deployed_addresses.json`

**Idempotency:** Ignition uses `ignition/deployments/chain-11155111/journal.jsonl` to track execution state. If a deploy is interrupted, re-running the same command resumes from where it stopped rather than redeploying already-deployed contracts.

**Expected output:**

```
Hardhat Ignition 🚀

Deploying [ DACSModule ]

Batch #1
  Executed DACSModule#RegistryContract

Batch #2
  Executed DACSModule#CredentialContract

[ DACSModule ] successfully deployed 🚀

Deployed Addresses
DACSModule#RegistryContract  - 0x...
DACSModule#CredentialContract - 0x...

Verifying deployed contracts
Submitted contract for verification:
  ...
Successfully verified contract RegistryContract ...
Successfully verified contract CredentialContract ...
```

Save the deployed addresses — you will need them for the frontend.

---

## Verify on Etherscan

Verification is included automatically in `npm run deploy:sepolia` via the `--verify` flag.

If verification was skipped or failed during deploy, run it separately:

```bash
./node_modules/.bin/hardhat ignition verify chain-11155111 --include-unrelated-contracts
```

After successful verification, both contracts appear on Sepolia Etherscan with source code and a "Read Contract / Write Contract" UI.

**Common verification failure: Etherscan API key format**

The `apiKey` in `hardhat.config.ts` must be a **string**, not an object:

```ts
// ✅ Correct — activates Etherscan V2 API (hardhat-verify v2.1.3+)
etherscan: {
  apiKey: ETHERSCAN_API_KEY,
}

// ❌ Wrong — triggers deprecated V1 endpoint, returns "deprecated" error
etherscan: {
  apiKey: { sepolia: ETHERSCAN_API_KEY },
}
```

---

## Start the Frontend

The frontend directory (`frontend/`) is currently a placeholder. When implemented:

```bash
cd frontend
npm install
npm run dev       # or: npm start
```

**Frontend stack (planned):** Ethers.js v6 + MetaMask.

**Contract address configuration:** The frontend will read deployed addresses from environment variables or a config file. After deploying to Sepolia, update the frontend config with:

```
REGISTRY_ADDRESS=0x3193c25d8A69758B8836c47f6105d4cD6d46563e
CREDENTIAL_ADDRESS=0x403493392013806b3dC5Bea7C031e02E641ad336
```

**Connecting to MetaMask (Ethers.js v6):**

```ts
// v6: BrowserProvider, not Web3Provider
const provider = new ethers.BrowserProvider(window.ethereum);

// Always check chainId — prompt user to switch to Sepolia if wrong
const network = await provider.getNetwork();
if (network.chainId !== 11155111n) {
  await window.ethereum.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: '0xaa36a7' }],  // 11155111 in hex
  });
}

const signer = await provider.getSigner();
```

**Hashing credential data client-side:**

```ts
// Raw data never leaves the browser — only the hash goes on-chain
const raw = `student:${name}|degree:${degree}|year:${year}`;
const credentialHash = ethers.keccak256(ethers.toUtf8Bytes(raw));
```

**Role-specific flows:**

```ts
// Issuer: issue a credential
const tx = await credentialContract.connect(signer).issueCredential(holderAddress, credentialHash);
await tx.wait();

// Holder: grant verifier access
const tx = await credentialContract.connect(signer).grantVerifierAccess(credentialHash, verifierAddress);
await tx.wait();

// Verifier: verify a credential (view call — no gas, no MetaMask popup)
const [valid, reason] = await credentialContract.connect(signer).verifyCredential(credentialHash);
console.log(valid ? "✅ Valid" : `❌ Invalid: ${reason}`);
```

---

## Interact with Deployed Contracts

### Via Etherscan UI

Both contracts are verified. Navigate to their Sepolia Etherscan pages and use "Write Contract" (connect MetaMask) or "Read Contract" (no wallet needed).

- RegistryContract: https://sepolia.etherscan.io/address/0x3193c25d8A69758B8836c47f6105d4cD6d46563e
- CredentialContract: https://sepolia.etherscan.io/address/0x403493392013806b3dC5Bea7C031e02E641ad336

### Via Hardhat Console

```bash
./node_modules/.bin/hardhat console --network sepolia
```

```ts
// In the Hardhat console (TypeScript):
const Registry = await ethers.getContractFactory("RegistryContract");
const registry = Registry.attach("0x3193c25d8A69758B8836c47f6105d4cD6d46563e");

const [signer] = await ethers.getSigners();
console.log("Owner:", await registry.owner());
console.log("Is registered:", await registry.isRegisteredIssuer(signer.address));
```

### Via ethers.js script

Create a script in `scripts/interact.ts`:

```ts
import { ethers } from "hardhat";

async function main() {
  const [owner] = await ethers.getSigners();

  const registry = await ethers.getContractAt(
    "RegistryContract",
    "0x3193c25d8A69758B8836c47f6105d4cD6d46563e"
  );
  const credential = await ethers.getContractAt(
    "CredentialContract",
    "0x403493392013806b3dC5Bea7C031e02E641ad336"
  );

  // Register an issuer
  const issuerAddress = "0xYourIssuerAddress";
  const tx = await registry.connect(owner).registerIssuer(issuerAddress);
  await tx.wait();
  console.log("Issuer registered:", issuerAddress);

  // Issue a credential
  const holderAddress = "0xYourHolderAddress";
  const raw = "student:alice|degree:CS|year:2024";
  const hash = ethers.keccak256(ethers.toUtf8Bytes(raw));
  const issueTx = await credential.connect(owner).issueCredential(holderAddress, hash);
  await issueTx.wait();
  console.log("Credential issued. Hash:", hash);
}

main().catch(console.error);
```

Run it:

```bash
./node_modules/.bin/hardhat run scripts/interact.ts --network sepolia
```

---

## Troubleshooting

### `npx hardhat` downloads Hardhat v3 instead of using local v2

**Problem:** `npx` resolves to the latest published version.

**Fix:** Always use local binary or npm scripts:
```bash
./node_modules/.bin/hardhat compile
# or
npm run compile
```

---

### `Error HH8: Cannot find module ... hardhat/config`

**Problem:** Running from wrong directory.

**Fix:**
```bash
pwd   # must be /path/to/dacs
cd /path/to/dacs
npm run compile
```

---

### `IGN723: Account index 0 is out of bounds. 0 accounts`

**Problem:** `PRIVATE_KEY` in `.env` is missing, has wrong format, or is still the placeholder value.

**Fix:** Ensure `.env` contains:
```
PRIVATE_KEY=0x[exactly 64 hex characters]
```
Total length must be 66 characters. Verify:
```bash
# Print length (should be 66)
node -e "require('dotenv').config(); console.log(process.env.PRIVATE_KEY?.length)"
```

---

### `Warning: PRIVATE_KEY missing or invalid` at startup

**Problem:** Same as above — key fails the regex `^0x[0-9a-fA-F]{64}$`.

Common causes:
- Missing `0x` prefix
- Key is an address (20 bytes / 40 hex chars) instead of a private key (32 bytes / 64 hex chars)
- Extra spaces or quotes in `.env`

---

### Etherscan verification: `The API endpoint you are using is deprecated`

**Problem:** `etherscan.apiKey` in `hardhat.config.ts` is an object `{ sepolia: KEY }` — this triggers the deprecated V1 endpoint.

**Fix:** Use a string:
```ts
etherscan: {
  apiKey: ETHERSCAN_API_KEY,   // string, not { sepolia: KEY }
}
```

---

### Etherscan verification: `Missing chainid parameter`

**Problem:** Same as above — object form triggers V1 which constructs a URL without `chainid`.

**Fix:** Same fix — string `apiKey`.

---

### `TS5011: rootDir is expected to contain all source files`

**Problem:** TypeScript rootDir doesn't cover all source files (e.g., test files are outside rootDir).

**Fix:** `tsconfig.json` must have `"rootDir": "."` (project root), not `"rootDir": "./contracts"` or similar.

---

### Tests fail with `TypeError: Cannot read properties of undefined (reading 'address')`

**Problem:** Using Ethers.js v5 patterns with v6. In v6:
- `contract.address` → `await contract.getAddress()`
- `BigNumber.from(x)` → native `BigInt` or `ethers.toBigInt(x)`
- `provider.getGasPrice()` → `(await provider.getFeeData()).gasPrice`

---

### `Error: no matching fragment` or `call revert exception`

**Problem:** Calling a function that doesn't exist on the contract, or passing wrong argument types.

**Fix:** Re-run `npm run compile` to regenerate TypeChain types, then check argument types match the function signature. Custom errors from OZ v5 (`OwnableUnauthorizedAccount`) are different from the string-based errors in OZ v4 — use `revertedWithCustomError` in tests, not `revertedWith`.

---

### Sepolia deploy is slow / times out

**Problem:** Network congestion or RPC rate limiting.

**Fix:**
- Check faucet balance: https://sepolia.etherscan.io/address/YOUR_ADDRESS
- Try a different RPC (Alchemy vs Infura)
- Ignition is idempotent — re-run `npm run deploy:sepolia` if interrupted; it resumes from the journal

---

### `hardhat compile` fails with `Source file requires different compiler version`

**Problem:** A dependency's pragma doesn't match `solidity.version` in `hardhat.config.ts`.

**Fix:** OpenZeppelin v5 requires Solidity `^0.8.20`. The project uses `0.8.24`, which satisfies this. If you added a third-party contract with a conflicting pragma, either update that file's pragma or add an override in `hardhat.config.ts`:

```ts
solidity: {
  compilers: [
    { version: "0.8.24" },
    { version: "0.8.20" },  // for older dependency
  ],
}
```

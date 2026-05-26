# DACS — Decentralized Academic Credential System

DACS is a two-contract Ethereum system for issuing, revoking, and verifying academic credentials. Raw credential data never touches the chain — only `keccak256` hashes are stored. Institutions issue credentials on-chain; students control which verifiers can see them.

Deployed on **Ethereum Sepolia**:
| Contract | Address |
|---|---|
| `RegistryContract` | [`0x3193c25d8A69758B8836c47f6105d4cD6d46563e`](https://sepolia.etherscan.io/address/0x3193c25d8A69758B8836c47f6105d4cD6d46563e) |
| `CredentialContract` | [`0x403493392013806b3dC5Bea7C031e02E641ad336`](https://sepolia.etherscan.io/address/0x403493392013806b3dC5Bea7C031e02E641ad336) |

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Roles](#roles)
3. [Privacy Model](#privacy-model)
4. [Contracts](#contracts)
   - [RegistryContract](#registrycontract)
   - [CredentialContract](#credentialcontract)
5. [Contract Interaction Flow](#contract-interaction-flow)
6. [File & Folder Reference](#file--folder-reference)
7. [Technology Stack](#technology-stack)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Ethereum Sepolia                         │
│                                                                 │
│   ┌──────────────────────┐       ┌──────────────────────────┐  │
│   │   RegistryContract   │◄──────│   CredentialContract     │  │
│   │                      │       │                          │  │
│   │  mapping:            │       │  struct Credential {     │  │
│   │   address → bool     │       │    bytes32 hash          │  │
│   │  (authorized         │       │    address issuer        │  │
│   │   issuers)           │       │    address holder        │  │
│   │                      │       │    bool revoked          │  │
│   │  Owner-controlled    │       │    uint256 issuedAt      │  │
│   │  (OZ Ownable v5)     │       │  }                       │  │
│   └──────────────────────┘       │                          │  │
│                                  │  mapping:                │  │
│                                  │   hash → verifier → bool │  │
│                                  │  (per-credential         │  │
│                                  │   allowlists)            │  │
│                                  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
          ▲                                   ▲
          │ registerIssuer/revokeIssuer       │ issueCredential
          │ (owner only)                      │ revokeCredential
     [Institution                             │ grantVerifierAccess
      Admin / Owner]                    [Issuers / Holders / Verifiers]
```

**CredentialContract holds a reference to RegistryContract** (set at deploy time, stored as `immutable`). Every `issueCredential` call checks `registry.isRegisteredIssuer(msg.sender)` at the moment of the call. Every `verifyCredential` call re-checks whether the original issuer is still registered — so revoking an institution's authorization automatically invalidates all credentials it ever issued.

---

## Roles

| Role | Address | Capabilities |
|---|---|---|
| **Owner** | Deployer (or whoever `transferOwnership` points to) | Register / revoke issuers on `RegistryContract` |
| **Issuer** | Any address registered by the Owner | Issue credentials, revoke credentials they issued |
| **Holder** | Recipient of a credential | Grant / revoke verifier access for their own credentials |
| **Verifier** | Any address the Holder explicitly grants | Call `verifyCredential` and receive `(true, "")` |

Roles are not tokens or NFTs — they are simple `mapping` entries and `msg.sender` checks.

---

## Privacy Model

**Raw credential data is never sent to or stored on the blockchain.**

The flow is:

```
Off-chain credential data:
  "student:alice|degree:CS|year:2024"
         │
         ▼
  keccak256 hash (computed client-side or by issuer backend)
  = 0xabc123...
         │
         ▼
  Only this 32-byte hash goes on-chain via issueCredential(holder, hash)
```

This means:
- The chain only records *that* a credential exists, *who* issued it, *who* holds it, and *whether* it has been revoked.
- The actual content (grades, dates, course details) stays off-chain (IPFS, issuer database, etc.).
- A verifier independently hashes the credential document they received off-chain and checks the hash on-chain.

**Consequence:** if the off-chain data is lost, the on-chain hash is unforgeable but unreadable. Issuers are responsible for maintaining the off-chain data source.

---

## Contracts

### RegistryContract

**File:** `contracts/Registry.sol`  
**Interface:** `contracts/IRegistry.sol`

Manages the set of addresses authorized to issue credentials. Inherits OpenZeppelin `Ownable` (v5), so the constructor requires an explicit `initialOwner` address.

#### State

```solidity
mapping(address => bool) private _registeredIssuers;
```

#### Functions

| Function | Access | Description |
|---|---|---|
| `registerIssuer(address issuer)` | `onlyOwner` | Adds `issuer` to authorized set. Emits `IssuerAdded`. Reverts: `ZeroAddress`, `AlreadyRegistered(issuer)` |
| `revokeIssuer(address issuer)` | `onlyOwner` | Removes `issuer` from authorized set. Emits `IssuerRemoved`. Reverts: `NotRegistered(issuer)` |
| `isRegisteredIssuer(address issuer)` | `view` | Returns `true` if issuer is currently authorized |

#### Events

| Event | Emitted when |
|---|---|
| `IssuerAdded(address indexed issuer)` | Issuer successfully registered |
| `IssuerRemoved(address indexed issuer)` | Issuer successfully revoked |

#### Custom Errors

| Error | Condition |
|---|---|
| `ZeroAddress()` | `issuer` argument is `address(0)` |
| `AlreadyRegistered(address)` | Calling `registerIssuer` on an already-registered address |
| `NotRegistered(address)` | Calling `revokeIssuer` on an unregistered address |

---

### CredentialContract

**File:** `contracts/Credential.sol`  
**Interface:** `contracts/ICredential.sol`

Issues and manages credentials identified by their `keccak256` hash. Holds an `immutable` reference to `RegistryContract` for real-time issuer authorization checks.

#### State

```solidity
IRegistry public immutable registry;  // set once at deploy; saves SLOAD vs regular state var

struct Credential {
    bytes32 credentialHash;  // keccak256 of off-chain data
    address issuer;
    address holder;
    bool revoked;
    uint256 issuedAt;        // 0 = does not exist (used as existence check)
}

mapping(bytes32 => Credential) private credentials;
mapping(bytes32 => mapping(address => bool)) private verifierAccess;
```

#### Functions

| Function | Access | Description |
|---|---|---|
| `issueCredential(address holder, bytes32 credentialHash)` | Registered issuer | Creates credential record. Emits `CredentialIssued`. |
| `revokeCredential(bytes32 credentialHash)` | Original issuer of that credential | Sets `revoked = true`. Emits `CredentialRevoked`. Permanent — no un-revoke. |
| `grantVerifierAccess(bytes32 credentialHash, address verifier)` | Credential holder | Adds `verifier` to allowlist. Emits `VerifierAccessGranted`. |
| `revokeVerifierAccess(bytes32 credentialHash, address verifier)` | Credential holder | Removes `verifier` from allowlist. Emits `VerifierAccessRevoked`. |
| `verifyCredential(bytes32 credentialHash)` | `view` — `msg.sender` is the verifier | Returns `(bool valid, string memory reason)`. Zero gas for callers. |

#### `verifyCredential` — Condition Order

Conditions are checked in this exact order. The **first** failing condition determines the returned reason:

1. `cred.issuedAt != 0` → else `(false, "Credential not found")`
2. `registry.isRegisteredIssuer(cred.issuer)` → else `(false, "Issuer no longer registered")`
3. `!cred.revoked` → else `(false, "Credential revoked")`
4. `verifierAccess[credentialHash][msg.sender]` → else `(false, "Caller not in verifier allowlist")`
5. All pass → `(true, "")`

Ordering matters: revoking an institution (condition 2) takes precedence over credential-level revocation (condition 3).

#### Events

| Event | Emitted when |
|---|---|
| `CredentialIssued(bytes32 indexed hash, address indexed issuer, address indexed holder)` | Credential issued |
| `CredentialRevoked(bytes32 indexed hash, address indexed issuer)` | Credential revoked |
| `VerifierAccessGranted(bytes32 indexed hash, address indexed holder, address indexed verifier)` | Holder grants verifier |
| `VerifierAccessRevoked(bytes32 indexed hash, address indexed holder, address indexed verifier)` | Holder revokes verifier |

#### Custom Errors

| Error | Condition |
|---|---|
| `NotAuthorizedIssuer()` | Caller not in `RegistryContract._registeredIssuers` |
| `NotCredentialIssuer()` | Caller is not the original issuer of this specific credential |
| `NotCredentialHolder()` | Caller is not the holder of this credential |
| `CredentialAlreadyExists(bytes32)` | Hash already recorded on-chain |
| `CredentialNotFound(bytes32)` | Hash not found (`issuedAt == 0`) |
| `CredentialAlreadyRevoked(bytes32)` | Credential already has `revoked = true` |
| `ZeroAddress()` | A required address argument is `address(0)` |

---

## Contract Interaction Flow

```
1.  Owner  →  RegistryContract.registerIssuer(issuerAddr)
                   emits IssuerAdded

2.  Issuer →  CredentialContract.issueCredential(holderAddr, keccak256Hash)
                   checks registry.isRegisteredIssuer(msg.sender)
                   emits CredentialIssued

3.  Holder →  CredentialContract.grantVerifierAccess(hash, verifierAddr)
                   emits VerifierAccessGranted

4.  Verifier → CredentialContract.verifyCredential(hash)  [view — no gas]
                   returns (true, "")

──── Later, if credential is revoked ────

5.  Issuer →  CredentialContract.revokeCredential(hash)
                   emits CredentialRevoked

6.  Verifier → CredentialContract.verifyCredential(hash)
                   returns (false, "Credential revoked")

──── Or if the institution is de-authorized ────

7.  Owner  →  RegistryContract.revokeIssuer(issuerAddr)
                   emits IssuerRemoved

8.  Verifier → CredentialContract.verifyCredential(hash)
                   returns (false, "Issuer no longer registered")
                   (affects ALL credentials ever issued by that issuer)
```

---

## File & Folder Reference

```
dacs/
│
├── contracts/
│   ├── IRegistry.sol          Interface for RegistryContract.
│   │                          Defines registerIssuer, revokeIssuer,
│   │                          isRegisteredIssuer, and both events.
│   │
│   ├── ICredential.sol        Interface for CredentialContract.
│   │                          Defines all 5 functions and all 4 events.
│   │                          verifyCredential takes no verifier param —
│   │                          caller (msg.sender) IS the verifier.
│   │
│   ├── Registry.sol           RegistryContract implementation.
│   │                          Inherits OZ Ownable v5 (needs initialOwner).
│   │                          Uses custom errors for gas efficiency.
│   │
│   └── Credential.sol         CredentialContract implementation.
│                              registry stored as immutable (saves SLOAD).
│                              issuedAt == 0 used as non-existence sentinel.
│
├── ignition/
│   └── modules/
│       └── DACS.ts            Hardhat Ignition deployment module.
│                              Deploys Registry first, then Credential.
│                              Credential receives the registry Future
│                              directly — Ignition resolves the address.
│                              Idempotent: re-running skips already-deployed
│                              contracts using the journal.
│
├── ignition/deployments/
│   └── chain-11155111/
│       ├── deployed_addresses.json   Final deployed addresses (Sepolia).
│       └── journal.jsonl             Ignition execution log. Never delete
│                                     this — it enables idempotent re-runs.
│
├── test/
│   ├── Registry.test.ts        17 unit tests for RegistryContract.
│   │                           Covers: deployment, registerIssuer (5 cases),
│   │                           revokeIssuer (5 cases), isRegisteredIssuer (4 cases).
│   │
│   ├── Credential.test.ts      32 unit tests for CredentialContract.
│   │                           Covers: deployment, issueCredential (7 cases),
│   │                           revokeCredential (5 cases), grantVerifierAccess
│   │                           (6 cases), revokeVerifierAccess (6 cases),
│   │                           verifyCredential (7 cases).
│   │
│   └── Credential.integration.test.ts
│                               11 integration tests — full lifecycle.
│                               Uses shared state (before not beforeEach) so
│                               tests run sequentially as a story:
│                               register → issue → grant → verify(true) →
│                               revoke → verify(false) → deregister issuer →
│                               verify(false, "Issuer no longer registered").
│
├── typechain-types/            Auto-generated TypeScript bindings for all
│                               contracts (from hardhat compile). Excluded
│                               from git. Never edit manually.
│
├── artifacts/                  Compiled ABI + bytecode output from Hardhat.
│                               Excluded from git. Regenerated on compile.
│
├── cache/                      Hardhat compilation cache. Excluded from git.
│
├── node_modules/               npm dependencies.
│
├── hardhat.config.ts           Hardhat configuration.
│                               - Solidity 0.8.24, optimizer 200 runs
│                               - Networks: hardhat, localhost, sepolia
│                               - TypeChain: ethers-v6 target
│                               - etherscan.apiKey as a string (activates
│                                 Etherscan V2 API in hardhat-verify v2.1.3+)
│
├── tsconfig.json               TypeScript config. rootDir must be "." so
│                               TS can compile hardhat.config.ts alongside
│                               test/ and scripts/ in one pass.
│
├── package.json                npm scripts and dependencies.
│                               type: "commonjs" (required — Hardhat v2
│                               does not support ESM).
│
├── .env                        Secret credentials. NEVER commit.
│                               See .env.example for required keys.
│
├── .env.example                Safe template for .env. Committed to git.
│
├── .gitignore                  Excludes: .env, artifacts/, cache/,
│                               typechain-types/, node_modules/, dist/,
│                               coverage/, .DS_Store.
│
├── CLAUDE.md                   AI assistant instructions and project spec.
│
└── README.md                   This file.
```

---

## Technology Stack

| Layer | Technology | Version | Notes |
|---|---|---|---|
| Smart contracts | Solidity | 0.8.24 | Custom errors, immutable, no SafeMath needed |
| Access control | OpenZeppelin Contracts | 5.6.1 | Ownable v5 requires explicit `initialOwner` |
| Dev framework | Hardhat | 2.28.6 | v2 (not v3 — toolbox incompatibility) |
| Hardhat plugins | hardhat-toolbox | 6.1.2 (`hh2` dist-tag) | Includes TypeChain, Ethers, coverage, verify |
| JS/TS runtime | Ethers.js | 6.x | BigInt, `waitForDeployment()`, `getAddress()` |
| Type bindings | TypeChain | ethers-v6 target | Auto-generated in `typechain-types/` |
| Testing | Chai + Hardhat Test | — | `revertedWithCustomError` for custom errors |
| Deployment | Hardhat Ignition | bundled | Declarative, idempotent, journal-based |
| Verification | hardhat-verify | 2.1.3 | String `apiKey` → Etherscan V2 API |
| Network | Ethereum Sepolia | chainId 11155111 | Testnet; ETH from Sepolia faucet |
| Language | TypeScript | 6.x | CommonJS modules, rootDir "." |

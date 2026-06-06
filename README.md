# DACS — Decentralized Academic Credential System

DACS is a full Ethereum dApp for issuing, revoking, and verifying academic credentials. It pairs two on-chain smart contracts with a browser frontend. Raw credential data never touches the chain — only `keccak256` fingerprints are stored on-chain, while the diploma PDF and its details live on IPFS. Schools issue credentials on-chain; students control which verifiers can see them; anyone can publicly look up a wallet's credentials with no login.

Deployed on **Ethereum Sepolia**:

| Contract | Address |
|---|---|
| `RegistryContract` | [`0xC4D2Ea8f7d80Ae7Cceee41d741428D4687c5833e`](https://sepolia.etherscan.io/address/0xC4D2Ea8f7d80Ae7Cceee41d741428D4687c5833e) |
| `CredentialContract` | [`0x7d1daB1874685d0e677c7927E424E1e37F89d644`](https://sepolia.etherscan.io/address/0x7d1daB1874685d0e677c7927E424E1e37F89d644) |

> A non-technical, plain-language walkthrough of the whole system lives in
> [`presentation.md`](presentation.md). Local run instructions are in
> [`RUNBOOK.md`](RUNBOOK.md).

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Roles](#roles)
3. [Privacy Model](#privacy-model)
4. [Contracts](#contracts)
   - [RegistryContract](#registrycontract)
   - [CredentialContract](#credentialcontract)
5. [Web App (Frontend)](#web-app-frontend)
6. [End-to-End Flow](#end-to-end-flow)
7. [Running Locally](#running-locally)
8. [File & Folder Reference](#file--folder-reference)
9. [Technology Stack](#technology-stack)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  Browser frontend (Vite + TypeScript + ethers v6 + MetaMask)          │
│   wallet-first login → role routing → Admin / Issuer / Student /       │
│   Verifier dashboards + public (no-login) credential lookup            │
└───────────────┬──────────────────────────────────┬───────────────────┘
                │ reads/writes (ethers)             │ upload / fetch
                ▼                                    ▼
┌─────────────────────────────────────────┐   ┌────────────────────────┐
│            Ethereum Sepolia              │   │   IPFS (via Pinata)     │
│                                          │   │                         │
│  ┌────────────────────┐  ┌────────────┐ │   │  diploma PDF +          │
│  │  RegistryContract   │◄─│ Credential │ │   │  JSON sidecar           │
│  │  • issuers (set)    │  │  Contract  │ │   │  (degree details)       │
│  │  • students (set)   │  │  • hashes  │ │   │  addressed by CID       │
│  │  • applications     │  │  • holders │ │   └────────────────────────┘
│  │  • admins (+owner)  │  │  • revoked │ │            ▲
│  │  OZ Ownable v5      │  │  • access  │ │            │ ipfs://CID
│  └────────────────────┘  └────────────┘ │            │ stored on-chain
│        ▲                        ▲         │───────────┘
│        │ onlyAdmin / onlyOwner  │ issuer / holder / verifier checks
└────────┼────────────────────────┼────────┘
         │                        │
   [Owner + Admins]      [Issuers / Holders / Verifiers]
```

**CredentialContract holds an `immutable` reference to RegistryContract** (set at deploy time). Every `issueCredential` checks `registry.isRegisteredIssuer(msg.sender)` at the moment of the call, and every `verifyCredential` re-checks whether the original issuer is still registered — so de-authorizing an institution automatically invalidates every credential it ever issued.

---

## Roles

| Role | Who | Capabilities |
|---|---|---|
| **Owner** | The head admin (deployer or `transferOwnership` target) | Everything an admin can do, **plus** add/remove admins |
| **Admin** | Owner + any address the owner grants | Approve/reject school & student applications; register/revoke issuers & students |
| **Issuer (School)** | Address approved by an admin | Issue credentials; revoke credentials they issued |
| **Student (Holder)** | Address approved by an admin / recipient of a credential | Receive credentials; grant/revoke verifier access for their own credentials |
| **Verifier (Employer)** | Any address a holder explicitly grants | Call `verifyCredential` and receive `(true, "")` |

Schools and students can **self-apply** on-chain; an admin must approve before they can participate. Roles are not tokens or NFTs — they are `mapping` entries plus `msg.sender` checks.

---

## Privacy Model

**Raw credential data is never stored on-chain.** The frontend computes a fingerprint client-side and stores only that:

```
Diploma details (held off-chain):
  studentAddr + degreeType + gradDate
         │
         ▼  solidityPackedKeccak256(["address","string","string"], [...])
  credentialHash = 0xabc123...        ← the only identity stored on-chain
         │
         ▼
  issueCredential(holder, credentialHash, "ipfs://CID")
```

- The chain records *that* a credential exists, *who* issued it, *who* holds it, *whether* it's revoked, and an `ipfs://` pointer.
- The diploma PDF and a JSON sidecar with the full degree details (level, major, department, graduation date) live on **IPFS**, addressed by a content hash (CID) that changes if the file changes.
- A verifier independently recomputes the hash from the details they were given and checks it on-chain. The hash is built **identically in the contract and in the website**, so they always agree.

**Consequence:** if the off-chain data is lost, the on-chain hash is unforgeable but unreadable. Issuers/holders are responsible for the off-chain document (Pinata keeps it pinned).

---

## Contracts

### RegistryContract

**File:** `contracts/Registry.sol` · **Interface:** `contracts/IRegistry.sol`

The gatekeeper. Tracks approved **issuers** and **students**, their **pending/rejected applications**, and a set of **admins** on top of the OpenZeppelin `Ownable` (v5) owner.

#### State

```solidity
mapping(address => bool) private _registeredIssuers;
mapping(address => bool) private _registeredStudents;
mapping(address => RequestStatus) public issuerRequestStatus;   // None | Pending | Rejected
mapping(address => RequestStatus) public studentRequestStatus;  // None | Pending | Rejected
mapping(address => bool) private _admins;                       // owner is always admin, not stored here
enum RequestStatus { None, Pending, Rejected }
```

Constructor: `constructor(address initialOwner, address[] memory initialAdmins)` — owner is always an admin; zero/owner/duplicate entries in `initialAdmins` are skipped.

#### Functions

| Function | Access | Description |
|---|---|---|
| `requestIssuer(string metadataURI)` | public | School self-applies. Sets status `Pending`, emits `IssuerRequested`. Reverts `AlreadyRegistered`, `RequestPending` |
| `requestStudent(string metadataURI)` | public | Student self-applies. Sets status `Pending`, emits `StudentRequested`. Reverts `AlreadyRegistered`, `RequestPending` |
| `registerIssuer(address issuer)` | `onlyAdmin` | Approve/add a school; clears its application. Emits `IssuerAdded`. Reverts `ZeroAddress`, `AlreadyRegistered` |
| `revokeIssuer(address issuer)` | `onlyAdmin` | Remove a school. Emits `IssuerRemoved`. Reverts `NotRegistered` |
| `rejectIssuerRequest(address applicant, string reason)` | `onlyAdmin` | Mark a school application `Rejected`. Emits `IssuerRequestRejected`. Reverts `NoPendingRequest` |
| `registerStudent(address student)` | `onlyAdmin` | Approve/add a student; clears its application. Emits `StudentAdded`. Reverts `ZeroAddress`, `AlreadyRegistered` |
| `revokeStudent(address student)` | `onlyAdmin` | Remove a student. Emits `StudentRemoved`. Reverts `NotRegistered` |
| `rejectStudentRequest(address applicant, string reason)` | `onlyAdmin` | Mark a student application `Rejected`. Emits `StudentRequestRejected`. Reverts `NoPendingRequest` |
| `addAdmin(address account)` | `onlyOwner` | Grant admin. Emits `AdminAdded`. Reverts `ZeroAddress`, `AlreadyAdmin` |
| `removeAdmin(address account)` | `onlyOwner` | Revoke admin. Emits `AdminRemoved`. Reverts `AdminNotFound` |
| `isAdmin(address)` | `view` | `true` if owner or a granted admin |
| `isRegisteredIssuer(address)` | `view` | `true` if currently an approved school |
| `isRegisteredStudent(address)` | `view` | `true` if currently an approved student |
| `issuerRequestStatus(address)` / `studentRequestStatus(address)` | `view` | Application status (`None`/`Pending`/`Rejected`) |

Approval is implicit: a school/student is "approved" once it is in the registered set — there is no separate `approve*` call (admins call `registerIssuer` / `registerStudent`). Only **rejection** is an explicit status.

#### Events

`IssuerAdded` · `IssuerRemoved` · `StudentAdded` · `StudentRemoved` · `AdminAdded` · `AdminRemoved` · `IssuerRequested(address indexed applicant, string metadataURI)` · `IssuerRequestRejected(address indexed applicant, string reason)` · `StudentRequested(...)` · `StudentRequestRejected(...)`

#### Custom Errors

`ZeroAddress` · `AlreadyRegistered(address)` · `NotRegistered(address)` · `RequestPending` · `NoPendingRequest` · `NotAdmin` · `AlreadyAdmin(address)` · `AdminNotFound(address)` — plus OZ `OwnableUnauthorizedAccount(address)` for owner-only calls.

---

### CredentialContract

**File:** `contracts/Credential.sol` · **Interface:** `contracts/ICredential.sol`

Issues and manages credentials identified by their `keccak256` hash. Holds an `immutable` reference to `RegistryContract` for real-time issuer-authorization checks.

#### State

```solidity
IRegistry public immutable registry;  // set once at deploy

struct Credential {
    bytes32 credentialHash;  // keccak256 of off-chain data
    address issuer;
    address holder;
    bool revoked;
    uint256 issuedAt;        // 0 = does not exist (existence sentinel)
    string metadataURI;      // "ipfs://CID" → off-chain diploma PDF + JSON sidecar
}

mapping(bytes32 => Credential) private credentials;
mapping(bytes32 => mapping(address => bool)) private verifierAccess;
```

#### Functions

| Function | Access | Description |
|---|---|---|
| `issueCredential(address holder, bytes32 credentialHash, string metadataURI)` | Registered issuer | Creates the record, stores IPFS URI. Emits `CredentialIssued`. |
| `revokeCredential(bytes32 credentialHash)` | Original issuer | Sets `revoked = true`. Emits `CredentialRevoked`. Permanent. |
| `grantVerifierAccess(bytes32 credentialHash, address verifier)` | Holder | Adds verifier to allowlist. Emits `VerifierAccessGranted`. |
| `revokeVerifierAccess(bytes32 credentialHash, address verifier)` | Holder | Removes verifier. Emits `VerifierAccessRevoked`. |
| `verifyCredential(bytes32 credentialHash)` | `view` — `msg.sender` is the verifier | Returns `(bool valid, string reason)`. |
| `getMetadataURI(bytes32 credentialHash)` | `view` | Returns stored `metadataURI`. Reverts `CredentialNotFound`. |

#### `verifyCredential` — Condition Order

First failing condition determines the reason:

1. `cred.issuedAt != 0` → else `(false, "Credential not found")`
2. `registry.isRegisteredIssuer(cred.issuer)` → else `(false, "Issuer no longer registered")`
3. `!cred.revoked` → else `(false, "Credential revoked")`
4. `verifierAccess[hash][msg.sender]` → else `(false, "Caller not in verifier allowlist")`
5. All pass → `(true, "")`

Ordering matters: de-authorizing an institution (condition 2) takes precedence over credential-level revocation (condition 3).

#### Events

`CredentialIssued(bytes32 indexed hash, address indexed issuer, address indexed holder, string metadataURI)` · `CredentialRevoked(bytes32 indexed hash, address indexed issuer)` · `VerifierAccessGranted(bytes32 indexed hash, address indexed holder, address indexed verifier)` · `VerifierAccessRevoked(...)`

#### Custom Errors

`NotAuthorizedIssuer` · `NotCredentialIssuer` · `NotCredentialHolder` · `CredentialAlreadyExists(bytes32)` · `CredentialNotFound(bytes32)` · `CredentialAlreadyRevoked(bytes32)` · `ZeroAddress`

---

## Web App (Frontend)

A single-page app (`frontend/`) that talks to both contracts via ethers v6 and MetaMask. No usernames or passwords — your wallet is your login.

- **Wallet-first login + role routing.** On connect, the app reads the chain (`isAdmin`, `isRegisteredIssuer`, `isRegisteredStudent`, credential events) and routes you to the right dashboard automatically. Admins are recognized on-chain **and** via a frontend allowlist (`ADMIN_ADDRESSES` in `config.ts`) so the right wallet reaches the admin view even before it's seeded on-chain. A wallet matching more than one role is sent to a "multiple roles" notice.
- **Admin dashboard.** Lists pending school and student applications with approve/reject (reason); a "Register Issuer Manually" form; and an owner-only **Manage Admins** panel to add/remove admins.
- **Issuer (school) dashboard.** Issue a credential (compute hash → upload PDF + JSON sidecar to Pinata → `issueCredential`), revoke credentials, and approve/reject student re-issuance requests (approve = revoke-old + issue-new; see [Re-issuance](#re-issuance)).
- **Student (holder) dashboard.** Every credential issued to the wallet, **grouped by issuing university** (shown by readable name, resolved from the school's application), with download PDF, manage verifier access, and request re-issuance per card (**reason only** — diploma details stay locked).
- **Verifier (employer) dashboard.** Re-enter the diploma details, the page rebuilds the same fingerprint, and `verifyCredential` returns ✅/❌.
- **Public credential lookup (no wallet).** The landing page has a "Verify a Credential" search: paste a wallet address → a full results page (student-dashboard style) grouped by university, each card showing the degree, a **View PDF** link, a **View on Etherscan** link to the issuance transaction, and a status badge (Active / Revoked / Issuer not registered). Read-only via a public RPC; no MetaMask required.

### Re-issuance

A student can request a fresh copy of a credential **without altering any diploma data**. In the request modal every diploma field (degree level, department, major, student ID, graduation date) is locked — the student supplies only a **reason** (≥10 chars). The request is queued for the issuing school (`reissueQueue.ts`); on **approval** the school **revokes the old credential and issues a new one carrying identical diploma data**.

The contract permanently rejects re-issuing an identical hash — even after revocation, `issuedAt` is never reset (`Credential.sol`). So the reason (salted with the request timestamp) is folded into the fingerprint, giving the reissued credential a unique hash:

```ts
reissueHash = solidityPackedKeccak256(
  ["address", "string", "string", "string"],
  [holder, degreeType, gradDate, reason + "\n#" + requestedAt]
);
```

The new IPFS sidecar records `reason` and `reissuedFrom` (the old hash). Verification stays **wallet-lookup based**: searching the student's wallet returns **both** credentials — old = **Revoked**, reissued = **Active**, each with its Issued date — so the most recent valid diploma is always identifiable. (Manual detail re-entry in the Verifier dashboard can't reproduce a reissued hash, since the reason isn't shared with the verifier; wallet/public lookup is the path for reissued credentials.)

Key frontend files: `frontend/src/main.ts` (all views + routing + contract calls), `frontend/src/config.ts` (addresses, ABIs, RPC endpoints, admin allowlist), `frontend/src/utils/ipfs.ts` (Pinata upload/lookup), `frontend/src/utils/reissueQueue.ts` (local re-issuance request queue), `frontend/src/data/mockStudents.ts` (degree-level/department/major option lists).

---

## End-to-End Flow

```
1.  School →  Registry.requestIssuer("ipfs://CID")        emits IssuerRequested
2.  Admin  →  Registry.registerIssuer(schoolAddr)         emits IssuerAdded
3.  Student → Registry.requestStudent("ipfs://CID")       emits StudentRequested
4.  Admin  →  Registry.registerStudent(studentAddr)       emits StudentAdded

5.  School →  Credential.issueCredential(studentAddr, hash, "ipfs://CID")
                 checks registry.isRegisteredIssuer(msg.sender)
                 emits CredentialIssued(hash, issuer, holder, metadataURI)

6.  Student → Credential.grantVerifierAccess(hash, employerAddr)
                 emits VerifierAccessGranted

7.  Employer → Credential.verifyCredential(hash)  [view — no gas] → (true, "")
    (or anyone → public lookup page, no login, reads CredentialIssued events)

──── Later ────
8.  School →  Credential.revokeCredential(hash)           → verify returns (false, "Credential revoked")
9.  Admin  →  Registry.revokeIssuer(schoolAddr)           → verify returns (false, "Issuer no longer registered")
                                                             for ALL that school's credentials

──── Re-issuance (reason only, identical diploma) ────
R1. Student → request re-issuance (reason only; diploma fields locked)  [off-chain queue]
R2. School  → approve → revokeCredential(oldHash)
                      → issueCredential(holder, reissueHash, "ipfs://CID")
                        reissueHash = keccak(holder, sameDegreeType, sameGradDate, reason+ts)
            → wallet lookup now shows old = Revoked, new = Active (newest = valid)
```

---

## Running Locally

See [`RUNBOOK.md`](RUNBOOK.md) for the full guide. Quick start:

```bash
# Contracts (repo root)
npm install
npm test                 # 104 tests (Hardhat)
npm run compile
npm run deploy:sepolia   # Hardhat Ignition (use --reset on bytecode change)

# Frontend
cd frontend
npm install
npm run dev              # http://localhost:5173
npm run build            # tsc && vite build → dist/
```

Secrets (Pinata keys, RPC URLs, contract addresses) go in `frontend/.env` and root `.env` — both are gitignored. See `*/.env.example`.

---

## File & Folder Reference

```
dacs/
├── contracts/
│   ├── IRegistry.sol         Registry interface — issuers, students, applications,
│   │                         admins, and all events/errors.
│   ├── ICredential.sol       Credential interface — 6 functions, 4 events.
│   ├── Registry.sol          RegistryContract — OZ Ownable v5 + onlyAdmin; self-serve
│   │                         applications + admin set. Constructor takes
│   │                         (initialOwner, initialAdmins[]).
│   └── Credential.sol        CredentialContract — immutable registry ref; issuedAt==0
│                             non-existence sentinel.
│
├── ignition/modules/DACS.ts  Hardhat Ignition module. Deploys Registry then Credential;
│                             passes owner/admins to Registry, registry address to
│                             Credential. Idempotent (journal-based).
├── ignition/deployments/     Per-chain deployed_addresses.json + journal.jsonl.
│
├── test/
│   ├── Registry.test.ts              56 unit tests (admins, applications, issuers, students).
│   ├── Credential.test.ts            36 unit tests.
│   └── Credential.integration.test.ts 12 integration tests — full lifecycle.
│
├── frontend/
│   ├── index.html            All views (connect, public result, admin, issuer, student,
│   │                         verifier, create-account, reissue modal).
│   ├── src/
│   │   ├── main.ts           View routing + all contract interactions + rendering.
│   │   ├── config.ts         Addresses, ABIs (with errors+events), RPC endpoints,
│   │   │                     ETHERSCAN_TX, PINATA_GATEWAY, ADMIN_ADDRESSES.
│   │   ├── utils/ipfs.ts     Pinata upload + pin-name lookup.
│   │   ├── utils/reissueQueue.ts  LocalStorage re-issuance request queue.
│   │   └── data/mockStudents.ts   Degree level / department / major option data.
│   ├── .env / .env.example   Pinata keys + addresses (NEVER commit .env).
│   └── CLAUDE.md             Frontend spec / assistant notes.
│
├── hardhat.config.ts         Solidity 0.8.24, optimizer 200, networks, TypeChain (ethers-v6).
├── tsconfig.json             rootDir "." (compiles config + tests in one pass).
├── package.json              type "commonjs" (Hardhat v2 requirement).
├── RUNBOOK.md                Step-by-step local + deploy guide.
├── presentation.md           Plain-language, non-technical walkthrough.
├── LOGIN_PLAN.md             Notes on the wallet-login / role-routing design.
├── CLAUDE.md                 Assistant instructions / project spec.
└── README.md                 This file.
```

(`typechain-types/`, `artifacts/`, `cache/`, `node_modules/`, `frontend/dist/` are generated and gitignored.)

---

## Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Smart contracts | Solidity 0.8.24 | Custom errors, `immutable`, OZ Ownable v5 |
| Access control | OpenZeppelin Contracts 5.x | `Ownable` + custom `onlyAdmin` modifier |
| Dev framework | Hardhat 2.x | toolbox: TypeChain, Ethers, coverage, verify |
| Deployment | Hardhat Ignition | Declarative, idempotent, journal-based |
| Verification | hardhat-verify | Etherscan V2 API |
| Type bindings | TypeChain (ethers-v6) | Generated in `typechain-types/` |
| Tests | Chai + Hardhat (104 tests) | `revertedWithCustomError` for custom errors |
| Frontend build | Vite 5 + TypeScript 5 | SPA, `npm run dev` / `build` |
| Web3 | Ethers.js v6 | `BrowserProvider` (wallet) + `JsonRpcProvider` (public reads) |
| Wallet | MetaMask | `window.ethereum`; chainId checked before calls |
| File storage | IPFS via Pinata | Diploma PDF + JSON sidecar, `ipfs://CID` on-chain |
| Network | Ethereum Sepolia | chainId 11155111 (testnet) |

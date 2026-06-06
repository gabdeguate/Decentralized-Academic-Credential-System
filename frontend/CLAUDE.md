# Frontend
Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

---

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

---

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

---

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

---

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## Stack
- Vite 5 + TypeScript 5
- Ethers.js v6
- MetaMask as wallet provider
- Pinata IPFS for PDF uploads
- Network: Ethereum Sepolia (chainId 11155111) or Hardhat Local (chainId 31337)

## Dev
```bash
cd frontend
npm install
npm run dev    # localhost:5173
npm run build  # dist/
```

## Config
- `frontend/src/config.ts` — contract addresses (from `import.meta.env.VITE_*`), full ABIs including all custom errors and events
- `frontend/.env` — never commit. Contains Pinata keys + contract addresses.
- `frontend/.env.example` — safe template, committed to git.

## Wallet Connection
- Use `BrowserProvider`, not `Web3Provider` (ethers v6)
- Always check chainId before any contract call — prompt user to switch if not correct network
- Store signer in state after connection
- `accountsChanged` / `chainChanged` → `location.reload()`
- `wallet_requestPermissions` with `{ eth_accounts: {} }` forces MetaMask account selector (Switch Account button)

## Hashing
```ts
// MUST match Solidity solidityPackedKeccak256(["address","string","string"], [...])
const hash = ethers.solidityPackedKeccak256(
  ["address", "string", "string"],
  [studentAddr, degreeType, gradDate]
);
```
Never use `keccak256(toUtf8Bytes(...))` — wrong encoding, won't match contract.

All three panels (Issuer / Holder / Verifier) must use identical inputs to compute same hash.

## IPFS (Pinata)
- Upload: `frontend/src/utils/ipfs.ts` → `uploadToPinata(file)` → returns CID
- Store: `metadataURI = "ipfs://CID"` passed to `issueCredential`
- Download: call `getMetadataURI(credHash)` → strip `ipfs://` → fetch from `https://gateway.pinata.cloud/ipfs/{CID}`
- Keys in `VITE_PINATA_API_KEY` / `VITE_PINATA_SECRET_API_KEY` — sent as request headers, visible in DevTools

## Contract Interaction
- Load contract addresses from `import.meta.env.VITE_*`
- ABIs in `config.ts` must include all custom errors (for ethers to decode revert reasons) and events (for `queryFilter`)
- `verifyCredential` — view call, `msg.sender` is the verifier
- `grantVerifierAccess` / `revokeVerifierAccess` — must be called by the credential holder

## Error Decoding
- Check `err.revert?.name` first (decoded custom error)
- Fall back to `err.shortMessage`
- For unknown selectors: `err.data.slice(0, 10)` is the 4-byte selector
- Known selectors in `contracts/CLAUDE.md`

## Role Flows
- **Issuer**: inputs (studentAddr, degreeType, gradDate) → hash → upload PDF to Pinata → `issueCredential(holder, hash, "ipfs://CID")`
- **Holder**: same 3 inputs → same hash → `grantVerifierAccess(hash, verifierAddr)` / `revokeVerifierAccess`
- **Verifier**: same 3 inputs → same hash → `verifyCredential(hash)` → `(bool valid, string reason)`

## Event Queries (Verifier Dashboard)
```ts
// queryFilter for CredentialIssued — first indexed topic = credentialHash
const filter = contract.filters.CredentialIssued(credHash);
const logs = await contract.queryFilter(filter, 0, "latest");
// args: [0]=credHash, [1]=issuer, [2]=holder, [3]=metadataURI

// Block timestamp for issue/revoke dates
const block = await provider.getBlock(log.blockNumber);
const ts = Number(block.timestamp);
```

Alchemy free tier limits `eth_getLogs` to 10-block range — use Etherscan V2 API as fallback.

## Common Issues
- **"could not decode result data"** on view call: wrong network in MetaMask, or wrong contract address
- **"unknown custom error"**: ABI missing error definition, or browser cached old bundle (`rm -rf node_modules/.vite`, hard reload)
- **`NotCredentialHolder`**: connected account ≠ credential holder. Use Switch Account button.
- **`CredentialAlreadyExists`**: same (studentAddr+degree+date) already issued. Change one input.
- **`AlreadyRegistered`**: issuer already registered from previous session — this is OK, show green.

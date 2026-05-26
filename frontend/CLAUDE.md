# Frontend

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

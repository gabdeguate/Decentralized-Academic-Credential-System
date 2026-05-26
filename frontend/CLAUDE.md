# Frontend

## Stack
- Ethers.js v6
- MetaMask as wallet provider
- Network: Ethereum Sepolia (chainId 11155111)

## Wallet connection
- Use BrowserProvider, not Web3Provider (ethers v6 change)
- Always check chainId before any contract call — prompt user to switch if not Sepolia
- Store signer in state after connection, not provider

## Contract interaction
- Load contract addresses from .env
- Always wrap contract calls in try/catch — surface revert reasons to the UI
- verifyCredential is a view call — use contract.verifyCredential() not signer

## Role flows
- Issuer UI: input student address + credential metadata → hash with keccak256 → call issueCredential
- Holder UI: input verifier address + credentialId → call grantAccess or revokeAccess
- Verifier UI: input student address + credentialId + metadata → hash locally → call verifyCredential → show valid/invalid

## Hashing
- Hash credential metadata client-side with ethers.keccak256(ethers.toUtf8Bytes(metadata))
- Never send raw metadata anywhere — only the hash goes to the contract
# Tests

## Stack
- Hardhat + ethers v6 + chai
- TypeScript

## Signers
- signers[0] = owner (deploys both contracts)
- signers[1] = issuer (registered in Registry)
- signers[2] = student/holder
- signers[3] = verifier
- signers[4] = attacker (unauthorized calls)

## Structure
- One test file per contract: Registry.test.ts, Credential.test.ts
- Group with describe() per function, it() per case

## Every function must cover
- Happy path
- Revert case (unauthorized caller or invalid input)
- Event emitted with correct args

## CredentialContract-specific cases
- verifyCredential returns false for revoked credential
- verifyCredential returns false for unauthorized verifier
- Only holder can call grantAccess and revokeAccess
- Unregistered issuer reverts on issueCredential

## Deployment helper
- Deploy Registry first
- Deploy CredentialContract with Registry address as constructor arg
- Register signers[1] as issuer in Registry before each test that needs it
- Use beforeEach to reset state between tests
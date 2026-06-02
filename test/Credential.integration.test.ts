import { expect } from "chai";
import { ethers } from "hardhat";
import { RegistryContract, CredentialContract } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("CredentialContract — end-to-end flow", function () {
  let registry: RegistryContract;
  let credential: CredentialContract;

  let owner: SignerWithAddress;
  let issuer: SignerWithAddress;
  let holder: SignerWithAddress;
  let verifier: SignerWithAddress;
  let stranger: SignerWithAddress;

  let credentialHash: string;

  before(async function () {
    [owner, issuer, holder, verifier, stranger] = await ethers.getSigners();

    // Deploy Registry
    const RegistryFactory = await ethers.getContractFactory("RegistryContract");
    registry = await RegistryFactory.deploy(owner.address, []);
    await registry.waitForDeployment();

    // Deploy Credential with registry address
    const CredentialFactory = await ethers.getContractFactory("CredentialContract");
    credential = await CredentialFactory.deploy(await registry.getAddress());
    await credential.waitForDeployment();

    // Compute credential hash off-chain (raw data never goes on-chain)
    credentialHash = ethers.keccak256(ethers.toUtf8Bytes("student:alice|degree:CS|year:2024"));
  });

  // ---------------------------------------------------------------------------
  // Step 1: Register issuer
  // ---------------------------------------------------------------------------

  it("Step 1 — owner registers issuer", async function () {
    await expect(registry.connect(owner).registerIssuer(issuer.address))
      .to.emit(registry, "IssuerAdded")
      .withArgs(issuer.address);

    expect(await registry.isRegisteredIssuer(issuer.address)).to.be.true;
  });

  // ---------------------------------------------------------------------------
  // Step 2: Issue credential
  // ---------------------------------------------------------------------------

  it("Step 2 — registered issuer issues credential to holder", async function () {
    await expect(
      credential.connect(issuer).issueCredential(holder.address, credentialHash, "ipfs://QmIntegrationTest")
    )
      .to.emit(credential, "CredentialIssued")
      .withArgs(credentialHash, issuer.address, holder.address, "ipfs://QmIntegrationTest");
  });

  it("Step 2a — unregistered address cannot issue", async function () {
    const otherHash = ethers.keccak256(ethers.toUtf8Bytes("other"));
    await expect(
      credential.connect(stranger).issueCredential(holder.address, otherHash, "")
    ).to.be.revertedWithCustomError(credential, "NotAuthorizedIssuer");
  });

  // ---------------------------------------------------------------------------
  // Step 2b: getMetadataURI returns stored URI
  // ---------------------------------------------------------------------------

  it("Step 2b — getMetadataURI returns stored IPFS URI", async function () {
    expect(await credential.getMetadataURI(credentialHash)).to.equal("ipfs://QmIntegrationTest");
  });

  // ---------------------------------------------------------------------------
  // Step 3: Holder grants verifier access
  // ---------------------------------------------------------------------------

  it("Step 3 — holder grants verifier access", async function () {
    await expect(
      credential.connect(holder).grantVerifierAccess(credentialHash, verifier.address)
    )
      .to.emit(credential, "VerifierAccessGranted")
      .withArgs(credentialHash, holder.address, verifier.address);
  });

  it("Step 3a — non-holder cannot grant access", async function () {
    await expect(
      credential.connect(stranger).grantVerifierAccess(credentialHash, stranger.address)
    ).to.be.revertedWithCustomError(credential, "NotCredentialHolder");
  });

  // ---------------------------------------------------------------------------
  // Step 4: Verifier calls verifyCredential — expects true
  // ---------------------------------------------------------------------------

  it("Step 4 — verifier gets (true, '') for valid credential", async function () {
    const [valid, reason] = await credential
      .connect(verifier)
      .verifyCredential(credentialHash);

    expect(valid).to.be.true;
    expect(reason).to.equal("");
  });

  it("Step 4a — stranger gets (false, 'Caller not in verifier allowlist')", async function () {
    const [valid, reason] = await credential
      .connect(stranger)
      .verifyCredential(credentialHash);

    expect(valid).to.be.false;
    expect(reason).to.equal("Caller not in verifier allowlist");
  });

  // ---------------------------------------------------------------------------
  // Step 5: Issuer revokes credential
  // ---------------------------------------------------------------------------

  it("Step 5 — issuer revokes credential", async function () {
    await expect(credential.connect(issuer).revokeCredential(credentialHash))
      .to.emit(credential, "CredentialRevoked")
      .withArgs(credentialHash, issuer.address);
  });

  it("Step 5a — non-issuer cannot revoke", async function () {
    const otherHash = ethers.keccak256(ethers.toUtf8Bytes("student:bob|degree:EE|year:2024"));
    await credential.connect(issuer).issueCredential(holder.address, otherHash, "");

    await expect(
      credential.connect(stranger).revokeCredential(otherHash)
    ).to.be.revertedWithCustomError(credential, "NotCredentialIssuer");
  });

  // ---------------------------------------------------------------------------
  // Step 6: Verifier calls again — expects false after revocation
  // ---------------------------------------------------------------------------

  it("Step 6 — verifier gets (false, 'Credential revoked') after revocation", async function () {
    const [valid, reason] = await credential
      .connect(verifier)
      .verifyCredential(credentialHash);

    expect(valid).to.be.false;
    expect(reason).to.equal("Credential revoked");
  });

  // ---------------------------------------------------------------------------
  // Step 7: Issuer de-registered — still-valid credential fails issuer check
  // ---------------------------------------------------------------------------

  it("Step 7 — owner revokes issuer registration", async function () {
    // Issue a fresh credential while issuer is still registered
    const freshHash = ethers.keccak256(ethers.toUtf8Bytes("student:carol|degree:ME|year:2025"));
    await credential.connect(issuer).issueCredential(holder.address, freshHash, "");
    await credential.connect(holder).grantVerifierAccess(freshHash, verifier.address);

    // Verify passes before de-registration
    const [validBefore] = await credential.connect(verifier).verifyCredential(freshHash);
    expect(validBefore).to.be.true;

    // Owner revokes issuer
    await registry.connect(owner).revokeIssuer(issuer.address);

    // Same credential now fails issuer-still-registered check
    const [valid, reason] = await credential.connect(verifier).verifyCredential(freshHash);
    expect(valid).to.be.false;
    expect(reason).to.equal("Issuer no longer registered");
  });
});

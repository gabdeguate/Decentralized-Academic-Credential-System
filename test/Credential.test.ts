import { expect } from "chai";
import { ethers } from "hardhat";
import { RegistryContract, CredentialContract } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("CredentialContract", function () {
  let registry: RegistryContract;
  let credential: CredentialContract;

  let owner: SignerWithAddress;
  let issuer: SignerWithAddress;
  let holder: SignerWithAddress;
  let verifier: SignerWithAddress;
  let stranger: SignerWithAddress;

  // A fixed hash representing off-chain credential data
  const CRED_HASH = ethers.keccak256(ethers.toUtf8Bytes("student:alice|degree:CS|year:2024"));
  const OTHER_HASH = ethers.keccak256(ethers.toUtf8Bytes("student:bob|degree:EE|year:2025"));

  beforeEach(async function () {
    [owner, issuer, holder, verifier, stranger] = await ethers.getSigners();

    const RegistryFactory = await ethers.getContractFactory("RegistryContract");
    registry = await RegistryFactory.deploy(owner.address);
    await registry.waitForDeployment();

    const CredentialFactory = await ethers.getContractFactory("CredentialContract");
    credential = await CredentialFactory.deploy(await registry.getAddress());
    await credential.waitForDeployment();

    // Register issuer by default — individual tests opt out when testing the negative case
    await registry.connect(owner).registerIssuer(issuer.address);
  });

  // ---------------------------------------------------------------------------
  // Deployment
  // ---------------------------------------------------------------------------

  describe("deployment", function () {
    it("stores registry address", async function () {
      expect(await credential.registry()).to.equal(await registry.getAddress());
    });

    it("reverts if registry address is zero", async function () {
      const Factory = await ethers.getContractFactory("CredentialContract");
      await expect(Factory.deploy(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(credential, "ZeroAddress");
    });
  });

  // ---------------------------------------------------------------------------
  // issueCredential
  // ---------------------------------------------------------------------------

  describe("issueCredential", function () {
    it("registered issuer can issue a credential", async function () {
      await expect(credential.connect(issuer).issueCredential(holder.address, CRED_HASH))
        .to.emit(credential, "CredentialIssued")
        .withArgs(CRED_HASH, issuer.address, holder.address);
    });

    it("emits CredentialIssued with correct args", async function () {
      const tx = await credential.connect(issuer).issueCredential(holder.address, CRED_HASH);
      const receipt = await tx.wait();
      expect(receipt?.status).to.equal(1);
    });

    it("unregistered issuer reverts NotAuthorizedIssuer", async function () {
      await expect(
        credential.connect(stranger).issueCredential(holder.address, CRED_HASH)
      ).to.be.revertedWithCustomError(credential, "NotAuthorizedIssuer");
    });

    it("reverts on zero holder address", async function () {
      await expect(
        credential.connect(issuer).issueCredential(ethers.ZeroAddress, CRED_HASH)
      ).to.be.revertedWithCustomError(credential, "ZeroAddress");
    });

    it("reverts on duplicate hash (CredentialAlreadyExists)", async function () {
      await credential.connect(issuer).issueCredential(holder.address, CRED_HASH);
      await expect(
        credential.connect(issuer).issueCredential(holder.address, CRED_HASH)
      ).to.be.revertedWithCustomError(credential, "CredentialAlreadyExists")
        .withArgs(CRED_HASH);
    });

    it("same issuer can issue different hashes", async function () {
      await credential.connect(issuer).issueCredential(holder.address, CRED_HASH);
      await expect(
        credential.connect(issuer).issueCredential(holder.address, OTHER_HASH)
      ).to.emit(credential, "CredentialIssued");
    });

    it("issuer cannot issue after being deregistered", async function () {
      await registry.connect(owner).revokeIssuer(issuer.address);
      await expect(
        credential.connect(issuer).issueCredential(holder.address, CRED_HASH)
      ).to.be.revertedWithCustomError(credential, "NotAuthorizedIssuer");
    });
  });

  // ---------------------------------------------------------------------------
  // revokeCredential
  // ---------------------------------------------------------------------------

  describe("revokeCredential", function () {
    beforeEach(async function () {
      await credential.connect(issuer).issueCredential(holder.address, CRED_HASH);
    });

    it("original issuer can revoke", async function () {
      await expect(credential.connect(issuer).revokeCredential(CRED_HASH))
        .to.emit(credential, "CredentialRevoked")
        .withArgs(CRED_HASH, issuer.address);
    });

    it("non-issuer reverts NotCredentialIssuer", async function () {
      await expect(
        credential.connect(stranger).revokeCredential(CRED_HASH)
      ).to.be.revertedWithCustomError(credential, "NotCredentialIssuer");
    });

    it("holder cannot revoke (not issuer)", async function () {
      await expect(
        credential.connect(holder).revokeCredential(CRED_HASH)
      ).to.be.revertedWithCustomError(credential, "NotCredentialIssuer");
    });

    it("non-existent credential reverts CredentialNotFound", async function () {
      await expect(
        credential.connect(issuer).revokeCredential(OTHER_HASH)
      ).to.be.revertedWithCustomError(credential, "CredentialNotFound")
        .withArgs(OTHER_HASH);
    });

    it("double revoke reverts CredentialAlreadyRevoked", async function () {
      await credential.connect(issuer).revokeCredential(CRED_HASH);
      await expect(
        credential.connect(issuer).revokeCredential(CRED_HASH)
      ).to.be.revertedWithCustomError(credential, "CredentialAlreadyRevoked")
        .withArgs(CRED_HASH);
    });
  });

  // ---------------------------------------------------------------------------
  // grantVerifierAccess
  // ---------------------------------------------------------------------------

  describe("grantVerifierAccess", function () {
    beforeEach(async function () {
      await credential.connect(issuer).issueCredential(holder.address, CRED_HASH);
    });

    it("holder can grant verifier access", async function () {
      await expect(
        credential.connect(holder).grantVerifierAccess(CRED_HASH, verifier.address)
      )
        .to.emit(credential, "VerifierAccessGranted")
        .withArgs(CRED_HASH, holder.address, verifier.address);
    });

    it("non-holder reverts NotCredentialHolder", async function () {
      await expect(
        credential.connect(stranger).grantVerifierAccess(CRED_HASH, verifier.address)
      ).to.be.revertedWithCustomError(credential, "NotCredentialHolder");
    });

    it("issuer cannot grant access (not holder)", async function () {
      await expect(
        credential.connect(issuer).grantVerifierAccess(CRED_HASH, verifier.address)
      ).to.be.revertedWithCustomError(credential, "NotCredentialHolder");
    });

    it("reverts on zero verifier address", async function () {
      await expect(
        credential.connect(holder).grantVerifierAccess(CRED_HASH, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(credential, "ZeroAddress");
    });

    it("non-existent credential reverts CredentialNotFound", async function () {
      await expect(
        credential.connect(holder).grantVerifierAccess(OTHER_HASH, verifier.address)
      ).to.be.revertedWithCustomError(credential, "CredentialNotFound")
        .withArgs(OTHER_HASH);
    });

    it("holder can grant access to multiple verifiers", async function () {
      const [, , , , , v2, v3] = await ethers.getSigners();
      await credential.connect(holder).grantVerifierAccess(CRED_HASH, verifier.address);
      await credential.connect(holder).grantVerifierAccess(CRED_HASH, v2.address);
      await expect(
        credential.connect(holder).grantVerifierAccess(CRED_HASH, v3.address)
      ).to.emit(credential, "VerifierAccessGranted");
    });
  });

  // ---------------------------------------------------------------------------
  // revokeVerifierAccess
  // ---------------------------------------------------------------------------

  describe("revokeVerifierAccess", function () {
    beforeEach(async function () {
      await credential.connect(issuer).issueCredential(holder.address, CRED_HASH);
      await credential.connect(holder).grantVerifierAccess(CRED_HASH, verifier.address);
    });

    it("holder can revoke verifier access", async function () {
      await expect(
        credential.connect(holder).revokeVerifierAccess(CRED_HASH, verifier.address)
      )
        .to.emit(credential, "VerifierAccessRevoked")
        .withArgs(CRED_HASH, holder.address, verifier.address);
    });

    it("non-holder reverts NotCredentialHolder", async function () {
      await expect(
        credential.connect(stranger).revokeVerifierAccess(CRED_HASH, verifier.address)
      ).to.be.revertedWithCustomError(credential, "NotCredentialHolder");
    });

    it("reverts on zero verifier address", async function () {
      await expect(
        credential.connect(holder).revokeVerifierAccess(CRED_HASH, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(credential, "ZeroAddress");
    });

    it("non-existent credential reverts CredentialNotFound", async function () {
      await expect(
        credential.connect(holder).revokeVerifierAccess(OTHER_HASH, verifier.address)
      ).to.be.revertedWithCustomError(credential, "CredentialNotFound")
        .withArgs(OTHER_HASH);
    });

    it("revoking access does not affect other verifiers", async function () {
      const [, , , , , v2] = await ethers.getSigners();
      await credential.connect(holder).grantVerifierAccess(CRED_HASH, v2.address);
      await credential.connect(holder).revokeVerifierAccess(CRED_HASH, verifier.address);

      // v2 still has access
      const [valid] = await credential.connect(v2).verifyCredential(CRED_HASH);
      expect(valid).to.be.true;

      // verifier no longer has access
      const [invalid, reason] = await credential.connect(verifier).verifyCredential(CRED_HASH);
      expect(invalid).to.be.false;
      expect(reason).to.equal("Caller not in verifier allowlist");
    });
  });

  // ---------------------------------------------------------------------------
  // verifyCredential
  // ---------------------------------------------------------------------------

  describe("verifyCredential", function () {
    it("returns (false, 'Credential not found') for unknown hash", async function () {
      const [valid, reason] = await credential.connect(verifier).verifyCredential(CRED_HASH);
      expect(valid).to.be.false;
      expect(reason).to.equal("Credential not found");
    });

    it("returns (false, 'Issuer no longer registered') after issuer deregistered", async function () {
      await credential.connect(issuer).issueCredential(holder.address, CRED_HASH);
      await credential.connect(holder).grantVerifierAccess(CRED_HASH, verifier.address);
      await registry.connect(owner).revokeIssuer(issuer.address);

      const [valid, reason] = await credential.connect(verifier).verifyCredential(CRED_HASH);
      expect(valid).to.be.false;
      expect(reason).to.equal("Issuer no longer registered");
    });

    it("returns (false, 'Credential revoked') after revocation", async function () {
      await credential.connect(issuer).issueCredential(holder.address, CRED_HASH);
      await credential.connect(holder).grantVerifierAccess(CRED_HASH, verifier.address);
      await credential.connect(issuer).revokeCredential(CRED_HASH);

      const [valid, reason] = await credential.connect(verifier).verifyCredential(CRED_HASH);
      expect(valid).to.be.false;
      expect(reason).to.equal("Credential revoked");
    });

    it("returns (false, 'Caller not in verifier allowlist') for unlisted caller", async function () {
      await credential.connect(issuer).issueCredential(holder.address, CRED_HASH);

      const [valid, reason] = await credential.connect(stranger).verifyCredential(CRED_HASH);
      expect(valid).to.be.false;
      expect(reason).to.equal("Caller not in verifier allowlist");
    });

    it("returns (true, '') when all conditions pass", async function () {
      await credential.connect(issuer).issueCredential(holder.address, CRED_HASH);
      await credential.connect(holder).grantVerifierAccess(CRED_HASH, verifier.address);

      const [valid, reason] = await credential.connect(verifier).verifyCredential(CRED_HASH);
      expect(valid).to.be.true;
      expect(reason).to.equal("");
    });

    it("issuer-check precedes revoked-check (condition ordering)", async function () {
      // Revoke credential AND deregister issuer
      await credential.connect(issuer).issueCredential(holder.address, CRED_HASH);
      await credential.connect(holder).grantVerifierAccess(CRED_HASH, verifier.address);
      await credential.connect(issuer).revokeCredential(CRED_HASH);
      await registry.connect(owner).revokeIssuer(issuer.address);

      // Issuer check (condition 2) fires before revoked check (condition 3)
      const [valid, reason] = await credential.connect(verifier).verifyCredential(CRED_HASH);
      expect(valid).to.be.false;
      expect(reason).to.equal("Issuer no longer registered");
    });

    it("re-registering issuer restores validity", async function () {
      await credential.connect(issuer).issueCredential(holder.address, CRED_HASH);
      await credential.connect(holder).grantVerifierAccess(CRED_HASH, verifier.address);

      await registry.connect(owner).revokeIssuer(issuer.address);
      const [invalid] = await credential.connect(verifier).verifyCredential(CRED_HASH);
      expect(invalid).to.be.false;

      await registry.connect(owner).registerIssuer(issuer.address);
      const [valid, reason] = await credential.connect(verifier).verifyCredential(CRED_HASH);
      expect(valid).to.be.true;
      expect(reason).to.equal("");
    });
  });
});

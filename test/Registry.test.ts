import { expect } from "chai";
import { ethers } from "hardhat";
import { RegistryContract } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("RegistryContract", function () {
  let registry: RegistryContract;
  let owner: SignerWithAddress;
  let issuer: SignerWithAddress;
  let stranger: SignerWithAddress;

  beforeEach(async function () {
    [owner, issuer, stranger] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("RegistryContract");
    registry = await Factory.deploy(owner.address);
    await registry.waitForDeployment();
  });

  // ---------------------------------------------------------------------------
  // Deployment
  // ---------------------------------------------------------------------------

  describe("deployment", function () {
    it("sets deployer as owner", async function () {
      expect(await registry.owner()).to.equal(owner.address);
    });

    it("starts with no registered issuers", async function () {
      expect(await registry.isRegisteredIssuer(issuer.address)).to.be.false;
    });
  });

  // ---------------------------------------------------------------------------
  // registerIssuer
  // ---------------------------------------------------------------------------

  describe("registerIssuer", function () {
    it("owner can register an issuer", async function () {
      await registry.connect(owner).registerIssuer(issuer.address);
      expect(await registry.isRegisteredIssuer(issuer.address)).to.be.true;
    });

    it("emits IssuerAdded on registration", async function () {
      await expect(registry.connect(owner).registerIssuer(issuer.address))
        .to.emit(registry, "IssuerAdded")
        .withArgs(issuer.address);
    });

    it("non-owner reverts with OwnableUnauthorizedAccount", async function () {
      await expect(
        registry.connect(stranger).registerIssuer(issuer.address)
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount")
        .withArgs(stranger.address);
    });

    it("reverts on zero address", async function () {
      await expect(
        registry.connect(owner).registerIssuer(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    });

    it("reverts if issuer already registered", async function () {
      await registry.connect(owner).registerIssuer(issuer.address);
      await expect(
        registry.connect(owner).registerIssuer(issuer.address)
      ).to.be.revertedWithCustomError(registry, "AlreadyRegistered")
        .withArgs(issuer.address);
    });

    it("can register multiple distinct issuers", async function () {
      const [, a, b, c] = await ethers.getSigners();
      await registry.connect(owner).registerIssuer(a.address);
      await registry.connect(owner).registerIssuer(b.address);
      await registry.connect(owner).registerIssuer(c.address);
      expect(await registry.isRegisteredIssuer(a.address)).to.be.true;
      expect(await registry.isRegisteredIssuer(b.address)).to.be.true;
      expect(await registry.isRegisteredIssuer(c.address)).to.be.true;
    });
  });

  // ---------------------------------------------------------------------------
  // revokeIssuer
  // ---------------------------------------------------------------------------

  describe("revokeIssuer", function () {
    beforeEach(async function () {
      await registry.connect(owner).registerIssuer(issuer.address);
    });

    it("owner can revoke a registered issuer", async function () {
      await registry.connect(owner).revokeIssuer(issuer.address);
      expect(await registry.isRegisteredIssuer(issuer.address)).to.be.false;
    });

    it("emits IssuerRemoved on revocation", async function () {
      await expect(registry.connect(owner).revokeIssuer(issuer.address))
        .to.emit(registry, "IssuerRemoved")
        .withArgs(issuer.address);
    });

    it("non-owner reverts with OwnableUnauthorizedAccount", async function () {
      await expect(
        registry.connect(stranger).revokeIssuer(issuer.address)
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount")
        .withArgs(stranger.address);
    });

    it("reverts if issuer not registered", async function () {
      await expect(
        registry.connect(owner).revokeIssuer(stranger.address)
      ).to.be.revertedWithCustomError(registry, "NotRegistered")
        .withArgs(stranger.address);
    });

    it("reverts on double-revoke", async function () {
      await registry.connect(owner).revokeIssuer(issuer.address);
      await expect(
        registry.connect(owner).revokeIssuer(issuer.address)
      ).to.be.revertedWithCustomError(registry, "NotRegistered")
        .withArgs(issuer.address);
    });
  });

  // ---------------------------------------------------------------------------
  // isRegisteredIssuer
  // ---------------------------------------------------------------------------

  describe("isRegisteredIssuer", function () {
    it("returns false for unknown address", async function () {
      expect(await registry.isRegisteredIssuer(stranger.address)).to.be.false;
    });

    it("returns true after registration", async function () {
      await registry.connect(owner).registerIssuer(issuer.address);
      expect(await registry.isRegisteredIssuer(issuer.address)).to.be.true;
    });

    it("returns false after revocation", async function () {
      await registry.connect(owner).registerIssuer(issuer.address);
      await registry.connect(owner).revokeIssuer(issuer.address);
      expect(await registry.isRegisteredIssuer(issuer.address)).to.be.false;
    });

    it("re-registration works after revocation", async function () {
      await registry.connect(owner).registerIssuer(issuer.address);
      await registry.connect(owner).revokeIssuer(issuer.address);
      await registry.connect(owner).registerIssuer(issuer.address);
      expect(await registry.isRegisteredIssuer(issuer.address)).to.be.true;
    });
  });

  // ---------------------------------------------------------------------------
  // Student flow (mirrors the issuer flow)
  // ---------------------------------------------------------------------------

  describe("requestStudent", function () {
    it("applicant can apply and status becomes Pending", async function () {
      await registry.connect(stranger).requestStudent("ipfs://app");
      expect(await registry.studentRequestStatus(stranger.address)).to.equal(1); // Pending
    });

    it("emits StudentRequested with the metadata URI", async function () {
      await expect(registry.connect(stranger).requestStudent("ipfs://app"))
        .to.emit(registry, "StudentRequested")
        .withArgs(stranger.address, "ipfs://app");
    });

    it("reverts with RequestPending on double-apply", async function () {
      await registry.connect(stranger).requestStudent("ipfs://app");
      await expect(
        registry.connect(stranger).requestStudent("ipfs://app2")
      ).to.be.revertedWithCustomError(registry, "RequestPending");
    });

    it("reverts with AlreadyRegistered if already a student", async function () {
      await registry.connect(owner).registerStudent(stranger.address);
      await expect(
        registry.connect(stranger).requestStudent("ipfs://app")
      ).to.be.revertedWithCustomError(registry, "AlreadyRegistered")
        .withArgs(stranger.address);
    });
  });

  describe("rejectStudentRequest", function () {
    beforeEach(async function () {
      await registry.connect(stranger).requestStudent("ipfs://app");
    });

    it("owner can reject a pending request", async function () {
      await registry.connect(owner).rejectStudentRequest(stranger.address, "no proof");
      expect(await registry.studentRequestStatus(stranger.address)).to.equal(2); // Rejected
    });

    it("emits StudentRequestRejected with the reason", async function () {
      await expect(registry.connect(owner).rejectStudentRequest(stranger.address, "no proof"))
        .to.emit(registry, "StudentRequestRejected")
        .withArgs(stranger.address, "no proof");
    });

    it("non-owner reverts with OwnableUnauthorizedAccount", async function () {
      await expect(
        registry.connect(issuer).rejectStudentRequest(stranger.address, "x")
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount")
        .withArgs(issuer.address);
    });

    it("reverts with NoPendingRequest when nothing is pending", async function () {
      await expect(
        registry.connect(owner).rejectStudentRequest(issuer.address, "x")
      ).to.be.revertedWithCustomError(registry, "NoPendingRequest");
    });
  });

  describe("registerStudent", function () {
    it("owner can register a student", async function () {
      await registry.connect(owner).registerStudent(stranger.address);
      expect(await registry.isRegisteredStudent(stranger.address)).to.be.true;
    });

    it("emits StudentAdded on registration", async function () {
      await expect(registry.connect(owner).registerStudent(stranger.address))
        .to.emit(registry, "StudentAdded")
        .withArgs(stranger.address);
    });

    it("clears a pending application on approval", async function () {
      await registry.connect(stranger).requestStudent("ipfs://app");
      await registry.connect(owner).registerStudent(stranger.address);
      expect(await registry.studentRequestStatus(stranger.address)).to.equal(0); // None
    });

    it("non-owner reverts with OwnableUnauthorizedAccount", async function () {
      await expect(
        registry.connect(stranger).registerStudent(stranger.address)
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount")
        .withArgs(stranger.address);
    });

    it("reverts on zero address", async function () {
      await expect(
        registry.connect(owner).registerStudent(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    });

    it("reverts if student already registered", async function () {
      await registry.connect(owner).registerStudent(stranger.address);
      await expect(
        registry.connect(owner).registerStudent(stranger.address)
      ).to.be.revertedWithCustomError(registry, "AlreadyRegistered")
        .withArgs(stranger.address);
    });
  });

  describe("revokeStudent", function () {
    beforeEach(async function () {
      await registry.connect(owner).registerStudent(stranger.address);
    });

    it("owner can revoke a registered student", async function () {
      await registry.connect(owner).revokeStudent(stranger.address);
      expect(await registry.isRegisteredStudent(stranger.address)).to.be.false;
    });

    it("emits StudentRemoved on revocation", async function () {
      await expect(registry.connect(owner).revokeStudent(stranger.address))
        .to.emit(registry, "StudentRemoved")
        .withArgs(stranger.address);
    });

    it("non-owner reverts with OwnableUnauthorizedAccount", async function () {
      await expect(
        registry.connect(issuer).revokeStudent(stranger.address)
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount")
        .withArgs(issuer.address);
    });

    it("reverts if student not registered", async function () {
      await expect(
        registry.connect(owner).revokeStudent(issuer.address)
      ).to.be.revertedWithCustomError(registry, "NotRegistered")
        .withArgs(issuer.address);
    });
  });

  describe("isRegisteredStudent", function () {
    it("returns false for unknown address", async function () {
      expect(await registry.isRegisteredStudent(stranger.address)).to.be.false;
    });

    it("re-registration works after revocation", async function () {
      await registry.connect(owner).registerStudent(stranger.address);
      await registry.connect(owner).revokeStudent(stranger.address);
      await registry.connect(owner).registerStudent(stranger.address);
      expect(await registry.isRegisteredStudent(stranger.address)).to.be.true;
    });

    it("issuer and student registries are independent", async function () {
      await registry.connect(owner).registerStudent(stranger.address);
      expect(await registry.isRegisteredIssuer(stranger.address)).to.be.false;
      await registry.connect(owner).registerIssuer(issuer.address);
      expect(await registry.isRegisteredStudent(issuer.address)).to.be.false;
    });
  });
});

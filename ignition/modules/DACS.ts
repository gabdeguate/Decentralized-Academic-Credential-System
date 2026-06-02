import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * DACS Ignition deployment module.
 *
 * Deployment order:
 *   1. RegistryContract  — owner set to deployer address (passed as parameter)
 *   2. CredentialContract — constructed with RegistryContract's deployed address
 *
 * Deploy to Sepolia:
 *   npm run deploy:sepolia
 *
 * Deploy to local node:
 *   npm run node          (in one terminal)
 *   npm run deploy:local  (in another)
 *
 * Override owner at deploy time:
 *   npx hardhat ignition deploy ignition/modules/DACS.ts \
 *     --network sepolia \
 *     --parameters '{"DACSModule":{"ownerAddress":"0xYourAddress"}}'
 */
const DACSModule = buildModule("DACSModule", (m) => {
  // Owns the RegistryContract. Defaults to deployer (account index 0).
  // Requires a valid PRIVATE_KEY in .env — that key's address becomes account 0.
  const ownerAddress = m.getParameter("ownerAddress", m.getAccount(0));

  // Extra admin wallets granted at deploy time. The owner is ALWAYS an admin and
  // need not be listed. Admins can approve/reject/register/revoke issuers and
  // students; only the owner can add/remove admins. Seeded in the constructor so
  // it works regardless of which key actually broadcasts the deploy.
  // Override: --parameters '{"DACSModule":{"adminAddresses":["0x..."]}}'
  const adminAddresses = m.getParameter("adminAddresses", [
    "0xfF48db6b1dC80546aB12d2B5F030D0bE6A591916",
  ]);

  // 1. Deploy RegistryContract
  const registry = m.contract("RegistryContract", [ownerAddress, adminAddresses]);

  // 2. Deploy CredentialContract — depends on registry, so Ignition sequences automatically
  const credential = m.contract("CredentialContract", [registry]);

  return { registry, credential };
});

export default DACSModule;

// Contract addresses — fall back to current deployed Sepolia addresses.
export const REGISTRY_ADDRESS: string =
  (import.meta.env.VITE_REGISTRY_ADDRESS as string | undefined) ??
  "0xc65AeAb4dB37A7cB1025cC9cC2c6231de7c65A9D";

export const CREDENTIAL_ADDRESS: string =
  (import.meta.env.VITE_CREDENTIAL_ADDRESS as string | undefined) ??
  "0x469Be3C83b7ec56d43dc7e468BcDf2815B13C52c";

export const SEPOLIA_CHAIN_ID = 11155111n;
export const ETHERSCAN_TX    = "https://sepolia.etherscan.io/tx/";
export const PINATA_GATEWAY  = "https://gateway.pinata.cloud/ipfs/";

// Minimal ABI — only the functions used by the frontend.
export const REGISTRY_ABI = [
  "function registerIssuer(address issuer) external",
  "function isRegisteredIssuer(address issuer) external view returns (bool)",
  // Errors — required for ethers to decode revert reasons
  "error ZeroAddress()",
  "error AlreadyRegistered(address issuer)",
  "error NotRegistered(address issuer)",
  "error OwnableUnauthorizedAccount(address account)", // OZ Ownable v5
] as const;

export const CREDENTIAL_ABI = [
  "function issueCredential(address holder, bytes32 credentialHash, string calldata metadataURI) external",
  "function revokeCredential(bytes32 credentialHash) external",
  "function grantVerifierAccess(bytes32 credentialHash, address verifier) external",
  "function revokeVerifierAccess(bytes32 credentialHash, address verifier) external",
  "function verifyCredential(bytes32 credentialHash) external view returns (bool valid, string reason)",
  "function getMetadataURI(bytes32 credentialHash) external view returns (string)",
  // Events — required for contract.filters.* and queryFilter
  "event CredentialIssued(bytes32 indexed credentialHash, address indexed issuer, address indexed holder, string metadataURI)",
  "event CredentialRevoked(bytes32 indexed credentialHash, address indexed issuer)",
  // Errors — required for ethers to decode revert reasons
  "error ZeroAddress()",
  "error NotAuthorizedIssuer()",
  "error NotCredentialIssuer()",
  "error NotCredentialHolder()",
  "error CredentialAlreadyExists(bytes32 credentialHash)",
  "error CredentialNotFound(bytes32 credentialHash)",
  "error CredentialAlreadyRevoked(bytes32 credentialHash)",
] as const;

// Contract addresses — fall back to deployed Sepolia addresses.
export const REGISTRY_ADDRESS: string =
  (import.meta.env.VITE_REGISTRY_ADDRESS as string | undefined) ??
  "0x3193c25d8A69758B8836c47f6105d4cD6d46563e";

export const CREDENTIAL_ADDRESS: string =
  (import.meta.env.VITE_CREDENTIAL_ADDRESS as string | undefined) ??
  "0x403493392013806b3dC5Bea7C031e02E641ad336";

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

// Contract addresses — fall back to current deployed Sepolia addresses.
export const REGISTRY_ADDRESS: string =
  (import.meta.env.VITE_REGISTRY_ADDRESS as string | undefined) ??
  "0xC4D2Ea8f7d80Ae7Cceee41d741428D4687c5833e";

export const CREDENTIAL_ADDRESS: string =
  (import.meta.env.VITE_CREDENTIAL_ADDRESS as string | undefined) ??
  "0x7d1daB1874685d0e677c7927E424E1e37F89d644";

export const SEPOLIA_CHAIN_ID = 11155111n;
export const ETHERSCAN_TX    = "https://sepolia.etherscan.io/tx/";
export const PINATA_GATEWAY  = "https://gateway.pinata.cloud/ipfs/";

// Wallets that always route to the admin dashboard, in addition to the on-chain
// contract owner. Frontend routing only — on-chain onlyOwner actions still require
// the wallet to be the actual Registry owner. Stored lowercase for comparison.
export const ADMIN_ADDRESSES: readonly string[] = [
  "0xFAbF6cfFd974e49e55732B957df00493D0562AE8",
].map((a) => a.toLowerCase());

// Minimal ABI — only the functions used by the frontend.
export const REGISTRY_ABI = [
  "function registerIssuer(address issuer) external",
  "function isRegisteredIssuer(address issuer) external view returns (bool)",
  "function owner() external view returns (address)",
  // Self-serve issuer application (school signup) — Phase 7
  "function requestIssuer(string metadataURI) external",
  "function rejectIssuerRequest(address applicant, string reason) external",
  "function issuerRequestStatus(address applicant) external view returns (uint8)", // 0=None 1=Pending 2=Rejected
  // Self-serve student application (student signup) — admin-validated
  "function requestStudent(string metadataURI) external",
  "function rejectStudentRequest(address applicant, string reason) external",
  "function registerStudent(address student) external",
  "function revokeStudent(address student) external",
  "function isRegisteredStudent(address student) external view returns (bool)",
  "function studentRequestStatus(address applicant) external view returns (uint8)", // 0=None 1=Pending 2=Rejected
  // Events — required for contract.filters.* and queryFilter
  "event IssuerAdded(address indexed issuer)",
  "event IssuerRequested(address indexed applicant, string metadataURI)",
  "event IssuerRequestRejected(address indexed applicant, string reason)",
  "event StudentAdded(address indexed student)",
  "event StudentRemoved(address indexed student)",
  "event StudentRequested(address indexed applicant, string metadataURI)",
  "event StudentRequestRejected(address indexed applicant, string reason)",
  // Errors — required for ethers to decode revert reasons
  "error ZeroAddress()",
  "error AlreadyRegistered(address issuer)",
  "error NotRegistered(address issuer)",
  "error RequestPending()",
  "error NoPendingRequest()",
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
  "event VerifierAccessGranted(bytes32 indexed credentialHash, address indexed holder, address indexed verifier)",
  "event VerifierAccessRevoked(bytes32 indexed credentialHash, address indexed holder, address indexed verifier)",
  // Errors — required for ethers to decode revert reasons
  "error ZeroAddress()",
  "error NotAuthorizedIssuer()",
  "error NotCredentialIssuer()",
  "error NotCredentialHolder()",
  "error CredentialAlreadyExists(bytes32 credentialHash)",
  "error CredentialNotFound(bytes32 credentialHash)",
  "error CredentialAlreadyRevoked(bytes32 credentialHash)",
] as const;

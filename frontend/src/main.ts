import {
  BrowserProvider,
  JsonRpcProvider,
  Contract,
  ContractRunner,
  EventLog,
  isAddress,
  solidityPackedKeccak256,
} from "ethers";
import {
  REGISTRY_ADDRESS,
  CREDENTIAL_ADDRESS,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_RPC_URL,
  SEPOLIA_RPC_FALLBACKS,
  ETHERSCAN_TX,
  PINATA_GATEWAY,
  REGISTRY_ABI,
  CREDENTIAL_ABI,
} from "./config.js";
import { uploadToPinata } from "./utils/ipfs.js";
import { MOCK_SCHOOLS, MAJORS_BY_DEPT, DEPARTMENTS, DEGREE_LEVELS } from "./data/mockStudents.js";

// ─── Global ethereum type ─────────────────────────────────────────────────────
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on: (event: string, handler: (...args: unknown[]) => void) => void;
    };
    connectWallet:      () => Promise<void>;
    updateCredHash:     (prefix: string) => void;
    doRegisterIssuer:   (btn: HTMLButtonElement) => Promise<void>;
    doIssueCredential:  (btn: HTMLButtonElement) => Promise<void>;
    doRevokeCredential: (btn: HTMLButtonElement) => Promise<void>;
    switchAccount:      () => Promise<void>;
    doGrantAccess:      (btn: HTMLButtonElement) => Promise<void>;
    doRevokeAccess:     (btn: HTMLButtonElement) => Promise<void>;
    doDownloadDiploma:  (btn: HTMLButtonElement) => Promise<void>;
    doVerify:           (btn: HTMLButtonElement) => Promise<void>;
    logout:             () => void;
    submitCreateAccount:(btn: HTMLButtonElement) => Promise<void>;
    publicLookup:       (btn: HTMLButtonElement) => Promise<void>;
    refreshMajors:      (prefix: string) => void;
  }
}

// ─── View-state machine (Phase 1) ─────────────────────────────────────────────
type UserRole = "none" | "issuer" | "student" | "verifier";
const VIEW_IDS = [
  "viewConnect",
  "viewMultiRoleError",
  "viewCreateAccount",
  "viewIssuer",
  "viewStudent",
  "viewVerifier",
] as const;
type ViewId = typeof VIEW_IDS[number];

let userRole:      UserRole = "none";
let connectedAddr: string   = "";

function showView(viewId: ViewId): void {
  for (const id of VIEW_IDS) {
    const el = document.getElementById(id);
    if (el) el.style.display = id === viewId ? "block" : "none";
  }
}

function setRoleBadge(role: UserRole, addr: string): void {
  const el = document.getElementById("currentRoleBadge");
  if (!el) return;
  if (role === "none" || !addr) {
    el.style.display = "none";
    el.textContent   = "";
    return;
  }
  const short = `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  el.textContent   = `Role: ${role} · ${short}`;
  el.style.display = "inline-flex";
}

function logout(): void {
  // Profile persists in localStorage so the wallet re-routes to the same dashboard
  // on reconnect. To "delete account" the user must clear localStorage manually
  // or use a different wallet.
  connectedAddr = "";
  userRole      = "none";
  location.reload();
}

function profileKey(addr: string): string {
  return `dacs:profile:${addr.toLowerCase()}`;
}

async function detectAndRoute(addr: string): Promise<void> {
  if (!registry || !credential) {
    showView("viewConnect");
    return;
  }

  // Parallel reads — each guarded so a single RPC failure can't block routing.
  const isIssuerP = (registry   as Contract).isRegisteredIssuer(addr)
                      .catch((e: unknown) => { console.warn("isRegisteredIssuer:", errMsg(e)); return false; });
  const ownerP    = (registry   as Contract).owner()
                      .catch((e: unknown) => { console.warn("owner:", errMsg(e)); return ""; });
  const issuedP   = (credential as Contract).queryFilter(
                      (credential as Contract).filters.CredentialIssued(null, null, addr), 0, "latest")
                      .catch((e: unknown) => { console.warn("CredentialIssued query:", errMsg(e)); return []; });
  const grantedP  = (credential as Contract).queryFilter(
                      (credential as Contract).filters.VerifierAccessGranted(null, null, addr), 0, "latest")
                      .catch((e: unknown) => { console.warn("VerifierAccessGranted query:", errMsg(e)); return []; });

  const [isIssuer, ownerAddr, issuedLogs, grantedLogs] = await Promise.all([
    isIssuerP, ownerP, issuedP, grantedP,
  ]);

  const isOwner = typeof ownerAddr === "string" && ownerAddr.length > 0
                  && ownerAddr.toLowerCase() === addr.toLowerCase();
  const profile = localStorage.getItem(profileKey(addr));

  const issuerMatch   = isOwner || isIssuer === true;
  const studentMatch  = (issuedLogs as unknown[]).length > 0 || profile !== null;
  const verifierMatch = (grantedLogs as unknown[]).length > 0;

  // Owner is allowed to also be issuer-registered (one role: issuer). Multi-role
  // only fires when the wallet matches across DIFFERENT role categories.
  const matchedRoles: UserRole[] = [];
  if (issuerMatch)   matchedRoles.push("issuer");
  if (studentMatch)  matchedRoles.push("student");
  if (verifierMatch) matchedRoles.push("verifier");

  if (matchedRoles.length >= 2) {
    userRole = "none";
    setRoleBadge("none", "");
    showView("viewMultiRoleError");
    return;
  }

  if (matchedRoles.length === 0) {
    userRole = "none";
    setRoleBadge("none", "");
    showView("viewCreateAccount");
    return;
  }

  const role = matchedRoles[0];
  userRole = role;
  setRoleBadge(role, addr);

  if (role === "issuer") {
    const ownerSection = document.getElementById("ownerOnlySection");
    if (ownerSection) ownerSection.style.display = isOwner ? "block" : "none";
    showView("viewIssuer");
  } else if (role === "student") {
    showView("viewStudent");
  } else {
    showView("viewVerifier");
  }
}

function populateSchoolSelect(): void {
  const sel = document.getElementById("signupSchool") as HTMLSelectElement | null;
  if (!sel || sel.options.length > 0) return;
  for (const school of MOCK_SCHOOLS) {
    const opt = document.createElement("option");
    opt.value = school;
    opt.textContent = school;
    sel.appendChild(opt);
  }
}

function fillSelect(id: string, options: readonly string[], placeholder: string): void {
  const sel = document.getElementById(id) as HTMLSelectElement | null;
  if (!sel || sel.options.length > 0) return;
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = placeholder;
  ph.disabled = true;
  ph.selected = true;
  sel.appendChild(ph);
  for (const v of options) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  }
}

// Refill that form's <datalist> with the majors offered in its current Department.
// Also clears the Major input + enables/disables it based on whether a dept is set.
function refreshMajors(prefix: string): void {
  const deptSel    = document.getElementById(`${prefix}Dept`)  as HTMLSelectElement | null;
  const majorInput = document.getElementById(`${prefix}Major`) as HTMLInputElement  | null;
  const dl         = document.getElementById(`${prefix}MajorsList`) as HTMLDataListElement | null;
  if (!deptSel || !majorInput || !dl) return;

  const dept    = deptSel.value;
  const options = dept ? MAJORS_BY_DEPT[dept] ?? [] : [];

  // Reset the datalist
  while (dl.firstChild) dl.removeChild(dl.firstChild);
  for (const m of options) {
    const opt = document.createElement("option");
    opt.value = m;
    dl.appendChild(opt);
  }

  // Stale major value? Drop it.
  if (majorInput.value && !options.includes(majorInput.value)) {
    majorInput.value = "";
  }

  if (dept) {
    majorInput.disabled    = false;
    majorInput.placeholder = `Start typing… (${options.length} majors in ${dept})`;
  } else {
    majorInput.disabled    = true;
    majorInput.placeholder = "Select department first…";
  }
}

function populateDegreeFields(): void {
  for (const prefix of ["issue", "revoke", "verify"]) {
    fillSelect(`${prefix}Level`, DEGREE_LEVELS, "Select level…");
    fillSelect(`${prefix}Dept`,  DEPARTMENTS,   "Select department…");
    refreshMajors(prefix); // initialize datalist (empty until dept chosen)
  }
}

async function submitCreateAccount(btn: HTMLButtonElement): Promise<void> {
  setLoading(btn, true);
  try {
    if (!connectedAddr) throw new Error("Wallet not connected.");
    const name   = getVal("signupName");
    const school = (document.getElementById("signupSchool") as HTMLSelectElement | null)?.value ?? "";
    if (!name)   throw new Error("Enter your name.");
    if (!school) throw new Error("Select a school.");

    localStorage.setItem(
      profileKey(connectedAddr),
      JSON.stringify({ name, school, createdAt: Date.now() }),
    );
    setResult("signupResult", "success", `✅ Account created. Routing…`);
    await detectAndRoute(connectedAddr);
  } catch (e) {
    setResult("signupResult", "error", `❌ ${errMsg(e)}`);
  } finally {
    setLoading(btn, false);
  }
}

// ─── State ────────────────────────────────────────────────────────────────────
let provider:   BrowserProvider | null = null;
let signer:     ContractRunner  | null = null;
let registry:   Contract        | null = null;
let credential: Contract        | null = null;

// ─── Read-only provider (public lookup — no wallet required) ──────────────────
let readProvider:   JsonRpcProvider;
let readCredential: Contract;
let readRegistry:   Contract;

async function initReadProvider(): Promise<void> {
  const urls = [SEPOLIA_RPC_URL, ...SEPOLIA_RPC_FALLBACKS];
  for (const url of urls) {
    try {
      const p = new JsonRpcProvider(url);
      await p.getBlockNumber();            // quick connectivity test
      readProvider   = p;
      readCredential = new Contract(CREDENTIAL_ADDRESS, CREDENTIAL_ABI, readProvider);
      readRegistry   = new Contract(REGISTRY_ADDRESS,   REGISTRY_ABI,   readProvider);
      console.log("[DACS] Read-only RPC connected:", url);
      return;
    } catch {
      console.warn("[DACS] RPC failed, trying next:", url);
    }
  }
  console.error("[DACS] All RPC endpoints failed.");
}

// Fire on page load — non-blocking
initReadProvider();

// ─── Wallet connection ────────────────────────────────────────────────────────
async function connectWallet(): Promise<void> {
  if (!window.ethereum) {
    alert("MetaMask not detected. Install the MetaMask browser extension first.");
    return;
  }

  try {
    provider = new BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);

    const network = await provider.getNetwork();
    if (network.chainId !== SEPOLIA_CHAIN_ID) {
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0xaa36a7" }],
        });
        provider = new BrowserProvider(window.ethereum);
      } catch {
        setWalletStatus("❌ Switch MetaMask to Sepolia network", false);
        return;
      }
    }

    signer     = await provider.getSigner();
    registry   = new Contract(REGISTRY_ADDRESS,   REGISTRY_ABI,   signer);
    credential = new Contract(CREDENTIAL_ADDRESS, CREDENTIAL_ABI, signer);

    const addr  = await (signer as Awaited<ReturnType<BrowserProvider["getSigner"]>>).getAddress();
    const short = `${addr.slice(0, 6)}…${addr.slice(-4)}`;
    setWalletStatus(`${short} · Sepolia`, true);
    connectedAddr = addr;

    const btn = document.getElementById("connectBtn") as HTMLButtonElement;
    btn.textContent = "Connected ✓";
    btn.disabled    = true;
    (document.getElementById("switchBtn") as HTMLElement).style.display = "inline-flex";
    (document.getElementById("logoutBtn") as HTMLElement).style.display = "inline-flex";

    window.ethereum.on("accountsChanged", () => location.reload());
    window.ethereum.on("chainChanged",    () => location.reload());

    await detectAndRoute(addr);
  } catch (e) {
    setWalletStatus(`❌ ${errMsg(e)}`, false);
  }
}

function setWalletStatus(msg: string, connected: boolean): void {
  const el = document.getElementById("walletStatus")!;
  el.textContent = msg;
  el.className   = connected ? "connected" : "";
}

async function ensureConnected(): Promise<void> {
  if (!signer || !credential || !registry) {
    throw new Error("Wallet not connected — click Connect MetaMask first.");
  }
}

// ─── Hash computation ─────────────────────────────────────────────────────────
function computeCredentialHash(
  studentAddress: string,
  degreeType: string,
  graduationDate: string
): string {
  return solidityPackedKeccak256(
    ["address", "string", "string"],
    [studentAddress, degreeType, graduationDate]
  );
}

// ─── Degree-type composition ─────────────────────────────────────────────────
// All rich fields (level, major, department, degree name, student ID) are
// packed into the single `degreeType` string so the on-chain hash stays
// `solidityPackedKeccak256(["address","string","string"], [...])` (contract API
// unchanged). Pipe delimiter is forbidden in any of the field values.
function composeDegreeType(prefix: string): { ok: boolean; composed: string; missing: string[] } {
  const level     = getVal(`${prefix}Level`);
  const major     = getVal(`${prefix}Major`);
  const dept      = getVal(`${prefix}Dept`);
  const studentId = getVal(`${prefix}StudentId`);

  const missing: string[] = [];
  if (!level)     missing.push("degree level");
  if (!dept)      missing.push("department");
  if (!major)     missing.push("major");
  if (!studentId) missing.push("student ID");
  if (missing.length > 0) return { ok: false, composed: "", missing };

  // Major must belong to the chosen department — guards against stale autocomplete
  // selections where dept was changed after major was filled.
  const allowed = MAJORS_BY_DEPT[dept];
  if (!allowed || !allowed.includes(major)) {
    throw new Error(`Major "${major}" is not offered in department "${dept}".`);
  }

  // Defensive: reject pipe character — would collide with the delimiter and
  // produce a different hash than what the verifier computes.
  for (const [k, v] of Object.entries({ level, major, dept, studentId })) {
    if (v.includes("|")) {
      throw new Error(`Field "${k}" cannot contain the "|" character.`);
    }
  }

  return {
    ok: true,
    composed: `${level}|${major}|${dept}|${studentId}`,
    missing: [],
  };
}

// ─── Live hash previews ───────────────────────────────────────────────────────
function updateCredHash(prefix: string): void {
  const studentAddr = getVal(`${prefix}StudentAddr`);
  const gradDate    = getVal(`${prefix}GradDate`);

  const preview = document.getElementById(`${prefix}HashPreview`);
  const value   = document.getElementById(`${prefix}HashValue`);
  if (!preview || !value) return;

  let composed = "";
  try {
    const r = composeDegreeType(prefix);
    if (!r.ok) { preview.style.display = "none"; return; }
    composed = r.composed;
  } catch {
    preview.style.display = "none";
    return;
  }

  if (studentAddr && composed && gradDate) {
    try {
      value.textContent     = computeCredentialHash(studentAddr, composed, gradDate);
      preview.style.display = "block";
    } catch {
      preview.style.display = "none";
    }
  } else {
    preview.style.display = "none";
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function getVal(id: string): string {
  return (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? "";
}

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setHtml(id: string, html: string): void {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function errMsg(e: unknown): string {
  console.error("[DACS error]", e);           // always log full object to DevTools
  if (e instanceof Error) {
    const err = e as Error & {
      shortMessage?: string;
      reason?: string;
      data?: string;
      revert?: { name: string; args?: unknown[] };
    };
    // Decoded custom error — name + args
    if (err.revert?.name) {
      const args = Array.isArray(err.revert.args) && err.revert.args.length > 0
        ? err.revert.args.join(", ")
        : "";
      return `${err.revert.name}(${args})`;
    }
    // Unknown custom error — append 4-byte selector so we can diagnose
    if (err.shortMessage?.includes("unknown custom error") && err.data) {
      return `${err.shortMessage} [selector: ${(err.data as string).slice(0, 10)}]`;
    }
    if (err.shortMessage) return err.shortMessage;
    if (err.reason)       return err.reason;
    const m = err.message.replace(/^execution reverted:\s*/i, "");
    return m.length > 280 ? m.slice(0, 280) + "…" : m;
  }
  return String(e);
}

function txLink(hash: string): string {
  const short = `${hash.slice(0, 12)}…${hash.slice(-6)}`;
  return `<a href="${ETHERSCAN_TX}${hash}" target="_blank" rel="noopener">↗ ${short}</a>`;
}

function setResult(id: string, type: "success" | "error" | "pending", html: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `result show ${type}`;
  el.innerHTML = html;
}

function setLoading(btn: HTMLButtonElement, loading: boolean): void {
  if (loading) {
    (btn as HTMLButtonElement & { _label?: string })._label = btn.textContent ?? "";
    btn.textContent = "⏳ Sending…";
    btn.disabled    = true;
  } else {
    btn.textContent = (btn as HTMLButtonElement & { _label?: string })._label ?? btn.textContent;
    btn.disabled    = false;
  }
}

function loading(text = "Loading…"): string {
  return `<span class="dash-loading">${text}</span>`;
}

function getCredHashFromPrefix(prefix: string): string {
  const studentAddr = getVal(`${prefix}StudentAddr`);
  const gradDate    = getVal(`${prefix}GradDate`);
  if (!studentAddr)            throw new Error("Enter student address.");
  if (!isAddress(studentAddr)) throw new Error(`Invalid student address: "${studentAddr}" — must be a valid 0x… Ethereum address.`);

  const { ok, composed, missing } = composeDegreeType(prefix);
  if (!ok) throw new Error(`Fill in all degree fields: ${missing.join(", ")}.`);
  if (!gradDate) throw new Error("Pick a graduation date.");

  return computeCredentialHash(studentAddr, composed, gradDate);
}

function formatTs(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

// ─── ISSUER: Register ─────────────────────────────────────────────────────────
async function doRegisterIssuer(btn: HTMLButtonElement): Promise<void> {
  setLoading(btn, true);
  try {
    await ensureConnected();
    const addr = getVal("regIssuerAddr");
    if (!addr) throw new Error("Enter an issuer address.");
    const tx = await (registry as Contract).registerIssuer(addr);
    setResult("regIssuerResult", "pending", `⏳ Pending… ${txLink(tx.hash)}`);
    await tx.wait();
    setResult("regIssuerResult", "success", `✅ Registered! ${txLink(tx.hash)}`);
  } catch (e) {
    const err = e as Error & { revert?: { name: string }; data?: string };
    const isAlreadyReg =
      err.revert?.name === "AlreadyRegistered" ||
      (typeof err.data === "string" && err.data.startsWith("0x45ed80e9"));
    if (isAlreadyReg) {
      setResult("regIssuerResult", "success", "✅ Issuer already registered.");
    } else {
      setResult("regIssuerResult", "error", `❌ ${errMsg(e)}`);
    }
  } finally {
    setLoading(btn, false);
  }
}

// ─── ISSUER: Issue credential ─────────────────────────────────────────────────
async function doIssueCredential(btn: HTMLButtonElement): Promise<void> {
  setLoading(btn, true);
  setResult("issueResult", "pending", "📤 Uploading diploma to IPFS…");
  try {
    await ensureConnected();
    const studentAddr = getVal("issueStudentAddr");
    const gradDate    = getVal("issueGradDate");
    const pdfInput    = document.getElementById("issuePdf") as HTMLInputElement;
    const pdfFile     = pdfInput?.files?.[0] ?? null;

    if (!studentAddr)            throw new Error("Enter student address.");
    if (!isAddress(studentAddr)) throw new Error(`Invalid student address: "${studentAddr}" — must be a valid 0x… Ethereum address.`);

    const { ok, composed, missing } = composeDegreeType("issue");
    if (!ok)        throw new Error(`Fill in all degree fields: ${missing.join(", ")}.`);
    if (!gradDate)  throw new Error("Pick a graduation date.");
    if (!pdfFile)   throw new Error("Select a diploma PDF file.");

    let cid: string;
    try {
      cid = await uploadToPinata(pdfFile);
    } catch (uploadErr) {
      throw new Error(`Upload failed: ${errMsg(uploadErr)}`);
    }

    const metadataURI = `ipfs://${cid}`;
    setResult("issueResult", "pending", `⛓ Submitting to Sepolia… CID: ${cid.slice(0, 12)}…`);

    const credHash = computeCredentialHash(studentAddr, composed, gradDate);
    const tx = await (credential as Contract).issueCredential(studentAddr, credHash, metadataURI);
    setResult("issueResult", "pending", `⏳ Pending… ${txLink(tx.hash)}`);
    await tx.wait();

    setResult(
      "issueResult",
      "success",
      `✅ Issued!<br>` +
      `IPFS: <a href="${PINATA_GATEWAY}${cid}" target="_blank" rel="noopener">${cid.slice(0, 14)}…</a><br>` +
      `<span class="mono">${credHash}</span>` +
      txLink(tx.hash)
    );
  } catch (e) {
    const msg = errMsg(e);
    setResult("issueResult", "error",
      msg.startsWith("Upload failed") ? `❌ ${msg}` : `❌ Transaction failed: ${msg}`);
  } finally {
    setLoading(btn, false);
  }
}

// ─── ISSUER: Revoke credential ────────────────────────────────────────────────
async function doRevokeCredential(btn: HTMLButtonElement): Promise<void> {
  setLoading(btn, true);
  try {
    await ensureConnected();
    const credHash = getCredHashFromPrefix("revoke");
    const tx = await (credential as Contract).revokeCredential(credHash);
    setResult("revokeResult", "pending", `⏳ Pending… ${txLink(tx.hash)}`);
    await tx.wait();
    setResult("revokeResult", "success",
      `✅ Revoked!<span class="mono">${credHash}</span>${txLink(tx.hash)}`);
  } catch (e) {
    setResult("revokeResult", "error", `❌ ${errMsg(e)}`);
  } finally {
    setLoading(btn, false);
  }
}

// ─── HOLDER: Grant verifier access ───────────────────────────────────────────
async function doGrantAccess(btn: HTMLButtonElement): Promise<void> {
  setLoading(btn, true);
  try {
    await ensureConnected();
    const credHash = getCredHashFromPrefix("grant");
    const verifier = getVal("grantVerifier");
    if (!verifier) throw new Error("Enter a verifier address.");
    const tx = await (credential as Contract).grantVerifierAccess(credHash, verifier);
    setResult("grantResult", "pending", `⏳ Pending… ${txLink(tx.hash)}`);
    await tx.wait();
    setResult("grantResult", "success",
      `✅ Access granted to ${verifier.slice(0, 8)}…<span class="mono">${credHash}</span>${txLink(tx.hash)}`);
  } catch (e) {
    setResult("grantResult", "error", `❌ ${errMsg(e)}`);
  } finally {
    setLoading(btn, false);
  }
}

// ─── HOLDER: Revoke verifier access ──────────────────────────────────────────
async function doRevokeAccess(btn: HTMLButtonElement): Promise<void> {
  setLoading(btn, true);
  try {
    await ensureConnected();
    const credHash = getCredHashFromPrefix("revokeAccess");
    const verifier = getVal("revokeAccessVerifier");
    if (!verifier) throw new Error("Enter a verifier address.");
    const tx = await (credential as Contract).revokeVerifierAccess(credHash, verifier);
    setResult("revokeAccessResult", "pending", `⏳ Pending… ${txLink(tx.hash)}`);
    await tx.wait();
    setResult("revokeAccessResult", "success",
      `✅ Access revoked for ${verifier.slice(0, 8)}…<span class="mono">${credHash}</span>${txLink(tx.hash)}`);
  } catch (e) {
    setResult("revokeAccessResult", "error", `❌ ${errMsg(e)}`);
  } finally {
    setLoading(btn, false);
  }
}

// ─── HOLDER: Download diploma from IPFS ──────────────────────────────────────
async function doDownloadDiploma(btn: HTMLButtonElement): Promise<void> {
  setLoading(btn, true);
  setResult("dlResult", "pending", "🔍 Looking up IPFS URI from contract…");
  try {
    await ensureConnected();
    const credHash = getCredHashFromPrefix("dl");

    const uri: string = await (credential as Contract).getMetadataURI(credHash);
    if (!uri || uri === "") {
      throw new Error("No diploma attached to this credential (metadataURI is empty).");
    }
    if (!uri.startsWith("ipfs://")) {
      throw new Error(`Unexpected URI scheme: ${uri}`);
    }

    const cid = uri.replace("ipfs://", "");
    const url = `${PINATA_GATEWAY}${cid}`;
    setResult("dlResult", "pending", `📥 Fetching from IPFS gateway…`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`IPFS fetch failed (${response.status}). Gateway may be slow — try again.`);
    }

    const blob      = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a         = document.createElement("a");
    a.href          = objectUrl;
    a.download      = `diploma_${credHash.slice(0, 10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);

    setResult(
      "dlResult",
      "success",
      `✅ Downloaded!<br>` +
      `<a href="${url}" target="_blank" rel="noopener">View on IPFS: ${cid.slice(0, 16)}…</a>`
    );
  } catch (e) {
    setResult("dlResult", "error", `❌ ${errMsg(e)}`);
  } finally {
    setLoading(btn, false);
  }
}

// ─── VERIFIER: Verify + show dashboard ───────────────────────────────────────

async function doVerify(btn: HTMLButtonElement): Promise<void> {
  setLoading(btn, true);

  // Reset dashboard to hidden while working
  const dashboard = document.getElementById("verifyDashboard")!;
  dashboard.className = "verify-dashboard";

  try {
    await ensureConnected();
    const credHash = getCredHashFromPrefix("verify");

    // Phase 1 — view call, instant, no gas ────────────────────────────────────
    const [valid, reason]: [boolean, string] =
      await (credential as Contract).verifyCredential(credHash);

    // Show dashboard with status immediately
    const statusEl = document.getElementById("dashStatus")!;
    if (valid) {
      dashboard.className = "verify-dashboard show verified";
      statusEl.className  = "dash-status verified";
      setText("dashIcon",   "✅");
      setText("dashLabel",  "CREDENTIAL VERIFIED");
      setText("dashReason", "");
    } else {
      dashboard.className = "verify-dashboard show invalid";
      statusEl.className  = "dash-status invalid";
      setText("dashIcon",   "❌");
      setText("dashLabel",  "CREDENTIAL INVALID");
      setText("dashReason", reason);
    }

    // Credential ID always known immediately
    setText("dashCredId", credHash);

    // Show animated placeholders while event queries run
    setHtml("dashHolder",    loading());
    setHtml("dashIssuer",    loading());
    setHtml("dashIssuerReg", "");
    setHtml("dashIssued",    loading());
    setHtml("dashRevoked",   loading());
    const diplomaRow = document.getElementById("dashDiplomaRow")!;
    diplomaRow.style.display = "none";

    // Phase 2 — event log queries (async, fills in rows as data arrives) ──────
    loadDashboardDetails(credHash).catch((e) => {
      // Non-fatal — dashboard status is already shown; log error to console
      console.warn("Dashboard detail fetch failed:", errMsg(e));
      setHtml("dashHolder",  `<span class="dash-val" style="color:var(--muted)">Could not load</span>`);
      setHtml("dashIssued",  `<span class="dash-val" style="color:var(--muted)">Could not load</span>`);
      setHtml("dashRevoked", `<span class="dash-val" style="color:var(--muted)">Could not load</span>`);
    });

  } catch (e) {
    // Top-level error (connect, bad input, RPC fail before view call)
    dashboard.className = "verify-dashboard show errored";
    const statusEl      = document.getElementById("dashStatus")!;
    statusEl.className  = "dash-status errored";
    setText("dashIcon",   "⚠️");
    setText("dashLabel",  "ERROR");
    setText("dashReason", errMsg(e));
    setText("dashCredId", "—");
    setHtml("dashHolder",    "—"); setHtml("dashIssuer", "—");
    setHtml("dashIssuerReg", "");  setHtml("dashIssued", "—"); setHtml("dashRevoked", "—");
  } finally {
    setLoading(btn, false);
  }
}

/**
 * loadDashboardDetails — runs after verifyCredential() returns.
 * Queries CredentialIssued + CredentialRevoked event logs in parallel,
 * then fills in holder, issuer, timestamps, registration status, and IPFS link.
 *
 * Uses queryFilter with the credentialHash as the first indexed topic.
 * Block timestamps fetched via provider.getBlock() — one call per event found.
 */
async function loadDashboardDetails(credHash: string): Promise<void> {
  if (!credential || !registry || !provider) return;

  // ── Parallel: issue events + revoke events ────────────────────────────────
  const issuedFilter  = (credential as Contract).filters.CredentialIssued(credHash);
  const revokedFilter = (credential as Contract).filters.CredentialRevoked(credHash);

  const [issuedLogs, revokedLogs] = await Promise.all([
    (credential as Contract).queryFilter(issuedFilter,  0, "latest"),
    (credential as Contract).queryFilter(revokedFilter, 0, "latest"),
  ]);

  // ── CredentialIssued ──────────────────────────────────────────────────────
  if (issuedLogs.length === 0) {
    // Credential may pre-date indexing or query failed
    setText("dashHolder", "Event not found on RPC");
    setText("dashIssuer", "Event not found on RPC");
    setText("dashIssued", "Event not found on RPC");
  } else {
    // Take the first (and only expected) issue event
    const ev  = issuedLogs[0] as EventLog;
    const args = ev.args;

    // ABI order: credentialHash (0), issuer (1), holder (2), metadataURI (3)
    const issuerAddr:  string = args[1] as string;
    const holderAddr:  string = args[2] as string;
    const metadataURI: string = args[3] as string;

    setText("dashHolder", holderAddr);
    setText("dashIssuer", issuerAddr);

    // Issuer registration status — live check (not from event)
    const isReg: boolean = await (registry as Contract).isRegisteredIssuer(issuerAddr);
    const regEl  = document.getElementById("dashIssuerReg")!;
    regEl.textContent = isReg ? "✓ Issuer still registered" : "✗ Issuer no longer registered";
    regEl.className   = `dash-badge ${isReg ? "ok" : "warn"}`;

    // Block timestamp for issue date
    const issueBlock = await provider!.getBlock(ev.blockNumber);
    setText("dashIssued", issueBlock ? formatTs(Number(issueBlock.timestamp)) : "Unknown");

    // IPFS diploma link
    if (metadataURI && metadataURI.startsWith("ipfs://")) {
      const cid  = metadataURI.replace("ipfs://", "");
      const url  = `${PINATA_GATEWAY}${cid}`;
      const link = document.getElementById("dashDiplomaLink") as HTMLAnchorElement;
      link.href        = url;
      link.textContent = `${cid.slice(0, 18)}… ↗ View PDF`;
      document.getElementById("dashDiplomaRow")!.style.display = "flex";
    }
  }

  // ── CredentialRevoked ─────────────────────────────────────────────────────
  if (revokedLogs.length === 0) {
    setHtml("dashRevoked", `<span class="text-ok">Not revoked</span>`);
  } else {
    const ev         = revokedLogs[0] as EventLog;
    const revokeBlock = await provider!.getBlock(ev.blockNumber);
    const revokeDate  = revokeBlock ? formatTs(Number(revokeBlock.timestamp)) : "Unknown date";
    setHtml("dashRevoked", `<span class="text-warn">Revoked ${revokeDate}</span>`);
  }
}

// ─── Switch MetaMask account ──────────────────────────────────────────────────
async function switchAccount(): Promise<void> {
  if (!window.ethereum) return;
  try {
    // wallet_requestPermissions forces MetaMask to show account selector
    await window.ethereum.request({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {} }],
    });
    // accountsChanged fires → location.reload() reconnects with new account
  } catch {
    // User closed MetaMask modal — ignore
  }
}

// ─── PUBLIC LOOKUP (no wallet required) ───────────────────────────────────────

interface PublicCredEntry {
  credHash:    string;
  issuer:      string;
  holder:      string;
  metadataURI: string;
  blockNumber: number;
  status:      "VALID" | "REVOKED" | "ISSUER INVALID";
  issuedDate:  string;
}

/**
 * queryFilterSafe — public RPCs often cap eth_getLogs block range.
 * Starts with a large window and halves it on failure until it works.
 */
async function queryFilterSafe(
  contract: Contract,
  filter: ReturnType<Contract["filters"][string]>,
  latestBlock: number,
): Promise<EventLog[]> {
  // Try progressively smaller ranges: full history → 500k → 250k → 100k → 50k
  const ranges = [latestBlock, 500_000, 250_000, 100_000, 50_000];
  for (const range of ranges) {
    const from = Math.max(0, latestBlock - range);
    try {
      return (await contract.queryFilter(filter, from, latestBlock)) as EventLog[];
    } catch {
      console.warn(`[DACS] queryFilter failed for range ${from}–${latestBlock}, trying smaller`);
    }
  }
  throw new Error("All block-range attempts failed. The RPC may be overloaded — try again later.");
}

async function publicLookup(btn: HTMLButtonElement): Promise<void> {
  const addr = getVal("publicLookupAddr");
  const listEl      = document.getElementById("publicCredentialList")!;
  const dashboardEl = document.getElementById("publicDashboard")!;

  // Reset UI
  listEl.innerHTML = "";
  dashboardEl.className = "verify-dashboard";

  if (!addr) {
    setResult("publicLookupResult", "error", "Enter a wallet address.");
    return;
  }
  if (!isAddress(addr)) {
    setResult("publicLookupResult", "error", "Invalid Ethereum address format.");
    return;
  }

  if (!readProvider) {
    setResult("publicLookupResult", "pending", "Connecting to blockchain…");
    await initReadProvider();
    if (!readProvider) {
      setResult("publicLookupResult", "error", "Could not connect to any Sepolia RPC endpoint. Please try again later.");
      return;
    }
  }

  setLoading(btn, true);
  setResult("publicLookupResult", "pending", "Searching blockchain events…");

  try {
    const latestBlock = await readProvider.getBlockNumber();

    // Query CredentialIssued events where holder = addr (3rd indexed param)
    const issuedFilter = readCredential.filters.CredentialIssued(null, null, addr);
    const issuedLogs   = await queryFilterSafe(readCredential, issuedFilter, latestBlock);

    if (issuedLogs.length === 0) {
      setResult("publicLookupResult", "error", "No credentials found for this address.");
      return;
    }

    const MAX_DISPLAY = 20;
    const truncated   = issuedLogs.length > MAX_DISPLAY;
    const logsToShow  = truncated ? issuedLogs.slice(-MAX_DISPLAY) : issuedLogs;

    setResult("publicLookupResult", "pending", `Found ${issuedLogs.length} credential(s). Loading details…`);

    // For each credential, fetch status in parallel
    const entries: PublicCredEntry[] = await Promise.all(
      logsToShow.map(async (log) => {
        const ev   = log as EventLog;
        const args = ev.args;

        const credHash:    string = args[0] as string;
        const issuerAddr:  string = args[1] as string;
        const holderAddr:  string = args[2] as string;
        const metadataURI: string = args[3] as string;

        // Parallel: revoke check + issuer registration + block timestamp
        const [revokeLogs, isReg, block] = await Promise.all([
          queryFilterSafe(readCredential, readCredential.filters.CredentialRevoked(credHash), latestBlock)
            .catch(() => [] as EventLog[]),
          readRegistry.isRegisteredIssuer(issuerAddr).catch(() => false),
          readProvider.getBlock(ev.blockNumber).catch(() => null),
        ]);

        let status: PublicCredEntry["status"] = "VALID";
        if (revokeLogs.length > 0) status = "REVOKED";
        else if (!isReg)           status = "ISSUER INVALID";

        const issuedDate = block ? formatTs(Number(block.timestamp)) : "Unknown";

        return { credHash, issuer: issuerAddr, holder: holderAddr, metadataURI, blockNumber: ev.blockNumber, status, issuedDate };
      })
    );

    // Render cards
    setResult("publicLookupResult", "success", `${issuedLogs.length} credential(s) found.`);

    for (const entry of entries) {
      const card = document.createElement("div");
      card.className = `cred-card${entry.status === "REVOKED" ? " revoked" : ""}`;

      const shortHash   = `${entry.credHash.slice(0, 10)}…${entry.credHash.slice(-6)}`;
      const shortIssuer = `${entry.issuer.slice(0, 6)}…${entry.issuer.slice(-4)}`;

      const badgeClass = entry.status === "VALID" ? "valid" : entry.status === "REVOKED" ? "revoked" : "invalid";

      card.innerHTML =
        `<div class="cred-card-info">` +
          `<span class="cred-card-hash">${shortHash}</span>` +
          `<span class="cred-card-meta">Issuer: ${shortIssuer} · ${entry.issuedDate}</span>` +
        `</div>` +
        `<span class="cred-card-badge ${badgeClass}">${entry.status}</span>`;

      card.addEventListener("click", () => showPublicDashboard(entry));
      listEl.appendChild(card);
    }

    if (truncated) {
      const msg = document.createElement("p");
      msg.className = "public-truncate-msg";
      msg.textContent = `Showing most recent ${MAX_DISPLAY} of ${issuedLogs.length} credentials.`;
      listEl.appendChild(msg);
    }

  } catch (e) {
    setResult("publicLookupResult", "error", `RPC error: ${errMsg(e)}`);
  } finally {
    setLoading(btn, false);
  }
}

function showPublicDashboard(entry: PublicCredEntry): void {
  const dashboard = document.getElementById("publicDashboard")!;

  // Status header
  const statusEl = document.getElementById("pubDashStatus")!;
  if (entry.status === "VALID") {
    dashboard.className = "verify-dashboard show verified";
    statusEl.className  = "dash-status verified";
    setText("pubDashIcon",   "✅");
    setText("pubDashLabel",  "CREDENTIAL VALID");
    setText("pubDashReason", "");
  } else if (entry.status === "REVOKED") {
    dashboard.className = "verify-dashboard show invalid";
    statusEl.className  = "dash-status invalid";
    setText("pubDashIcon",   "❌");
    setText("pubDashLabel",  "CREDENTIAL REVOKED");
    setText("pubDashReason", "This credential has been revoked by the issuer.");
  } else {
    dashboard.className = "verify-dashboard show errored";
    statusEl.className  = "dash-status errored";
    setText("pubDashIcon",   "⚠️");
    setText("pubDashLabel",  "ISSUER INVALID");
    setText("pubDashReason", "The issuing institution is no longer registered.");
  }

  setText("pubDashCredId", entry.credHash);
  setText("pubDashHolder", entry.holder);
  setText("pubDashIssuer", entry.issuer);
  setText("pubDashIssued", entry.issuedDate);

  // Issuer registration badge
  const regEl = document.getElementById("pubDashIssuerReg")!;
  if (entry.status === "ISSUER INVALID") {
    regEl.textContent = "✗ Issuer not registered";
    regEl.className   = "dash-badge warn";
  } else {
    regEl.textContent = "✓ Issuer registered";
    regEl.className   = "dash-badge ok";
  }

  // Revocation row
  if (entry.status === "REVOKED") {
    setHtml("pubDashRevoked", `<span class="text-warn">Revoked</span>`);
  } else {
    setHtml("pubDashRevoked", `<span class="text-ok">Not revoked</span>`);
  }

  // IPFS diploma link
  const diplomaRow = document.getElementById("pubDashDiplomaRow")!;
  if (entry.metadataURI && entry.metadataURI.startsWith("ipfs://")) {
    const cid  = entry.metadataURI.replace("ipfs://", "");
    const url  = `${PINATA_GATEWAY}${cid}`;
    const link = document.getElementById("pubDashDiplomaLink") as HTMLAnchorElement;
    link.href        = url;
    link.textContent = `${cid.slice(0, 18)}… ↗ View PDF`;
    diplomaRow.style.display = "flex";
  } else {
    diplomaRow.style.display = "none";
  }

  // Scroll into view
  dashboard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ─── Expose to window (inline onclick in index.html) ──────────────────────────
window.connectWallet      = connectWallet;
window.switchAccount      = switchAccount;
window.updateCredHash     = updateCredHash;
window.doRegisterIssuer   = doRegisterIssuer;
window.doIssueCredential  = doIssueCredential;
window.doRevokeCredential = doRevokeCredential;
window.doGrantAccess      = doGrantAccess;
window.doRevokeAccess     = doRevokeAccess;
window.doDownloadDiploma  = doDownloadDiploma;
window.doVerify           = doVerify;
window.logout              = logout;
window.submitCreateAccount = submitCreateAccount;
window.publicLookup        = publicLookup;
window.refreshMajors       = refreshMajors;

// Populate signup school <select> + degree dropdowns/datalist on boot
// (DOM is ready — script tag at end of body).
populateSchoolSelect();
populateDegreeFields();

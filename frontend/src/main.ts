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
  ADMIN_ADDRESSES,
} from "./config.js";
import { uploadToPinata, uploadJsonToPinata, fetchPinName } from "./utils/ipfs.js";
import {
  type ReissueReq,
  addReissueRequest,
  findReissueByCredHash,
  listPendingReissuesForIssuer,
  updateReissueRequest,
} from "./utils/reissueQueue.js";
import {
  MOCK_SCHOOLS,
  MAJORS_BY_DEPT,
  DEPARTMENTS,
  DEGREE_LEVELS,
} from "./data/mockStudents.js";

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
    studentDownload:    (credHash: string, btn: HTMLButtonElement) => Promise<void>;
    studentGrantAccess: (credHash: string, btn: HTMLButtonElement) => Promise<void>;
    studentRevokeAccess:(credHash: string, btn: HTMLButtonElement) => Promise<void>;
    toggleGrantForm:    (short: string) => void;
    requestReissuance:  (credHash: string, issuerAddr: string) => void;
    toggleLabelEdit:    (credHash: string) => void;
    saveLocalLabel:     (credHash: string, btn: HTMLButtonElement) => void;
    submitReissueRequest:(btn: HTMLButtonElement) => void;
    closeReissueModal:  () => void;
    approveReissue:     (reqId: string, btn: HTMLButtonElement) => Promise<void>;
    rejectReissue:      (reqId: string, btn: HTMLButtonElement) => void;
    toggleSignupRole:   () => void;
    reapply:            () => void;
    approveSchoolApp:   (addr: string, btn: HTMLButtonElement) => Promise<void>;
    rejectSchoolApp:    (addr: string, btn: HTMLButtonElement) => Promise<void>;
    approveStudentApp:  (addr: string, btn: HTMLButtonElement) => Promise<void>;
    rejectStudentApp:   (addr: string, btn: HTMLButtonElement) => Promise<void>;
    addAdminWallet:     (btn: HTMLButtonElement) => Promise<void>;
    removeAdminWallet:  (addr: string, btn: HTMLButtonElement) => Promise<void>;
  }
}

// ─── View-state machine (Phase 1) ─────────────────────────────────────────────
type UserRole = "none" | "admin" | "issuer" | "student" | "verifier";
const VIEW_IDS = [
  "viewConnect",
  "viewMultiRoleError",
  "viewCreateAccount",
  "viewAdmin",
  "viewIssuer",
  "viewStudent",
  "viewVerifier",
] as const;
type ViewId = typeof VIEW_IDS[number];

let userRole:      UserRole = "none";
let connectedAddr: string   = "";
// Role whose application was last rejected — drives the "Re-apply" button.
let lastRejectedRole: "student" | "school" = "student";

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
  const reqStatP  = (registry   as Contract).issuerRequestStatus(addr)
                      .catch((e: unknown) => { console.warn("issuerRequestStatus:", errMsg(e)); return 0; });
  const isStudentP = (registry  as Contract).isRegisteredStudent(addr)
                      .catch((e: unknown) => { console.warn("isRegisteredStudent:", errMsg(e)); return false; });
  const studentReqStatP = (registry as Contract).studentRequestStatus(addr)
                      .catch((e: unknown) => { console.warn("studentRequestStatus:", errMsg(e)); return 0; });
  const isAdminP = (registry as Contract).isAdmin(addr)
                      .catch((e: unknown) => { console.warn("isAdmin:", errMsg(e)); return false; });

  const [isIssuer, ownerAddr, issuedLogs, grantedLogs, reqStatus, isStudent, studentReqStatus, isOnchainAdmin] =
    await Promise.all([
      isIssuerP, ownerP, issuedP, grantedP, reqStatP, isStudentP, studentReqStatP, isAdminP,
    ]);

  const isOwner = typeof ownerAddr === "string" && ownerAddr.length > 0
                  && ownerAddr.toLowerCase() === addr.toLowerCase();
  const isConfiguredAdmin = ADMIN_ADDRESSES.includes(addr.toLowerCase());
  const profile = localStorage.getItem(profileKey(addr));

  // Admin = on-chain admin (owner or granted), OR a configured admin wallet (frontend
  // allowlist, lets a wallet reach the dashboard before it's seeded on-chain). Takes
  // precedence over every other role and gets its own dashboard. NOTE: on-chain
  // approve/reject still require the wallet to actually be an on-chain admin; the
  // "Manage Admins" panel (add/remove) is owner-only.
  if (isOwner || isConfiguredAdmin || isOnchainAdmin === true) {
    userRole = "admin";
    setRoleBadge("admin", addr);
    showView("viewAdmin");
    renderPendingSchoolApps(addr);
    renderPendingStudentApps(addr);
    renderManageAdmins(addr, isOwner);
    return;
  }

  const issuerMatch   = isIssuer === true;
  const studentMatch  = isStudent === true || (issuedLogs as unknown[]).length > 0 || profile !== null;
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
    const issuerStatus  = Number(reqStatus);        // 0=None 1=Pending 2=Rejected
    const studentStatus = Number(studentReqStatus); // 0=None 1=Pending 2=Rejected
    // Pending beats Rejected; show whichever role has an active application.
    if (issuerStatus === 1 || studentStatus === 1) {
      showCreateAccount("pending");
    } else if (issuerStatus === 2 || studentStatus === 2) {
      lastRejectedRole = studentStatus === 2 ? "student" : "school";
      showCreateAccount("rejected");
      loadRejectionReason(addr, lastRejectedRole);
    } else {
      showCreateAccount("form");
    }
    return;
  }

  const role = matchedRoles[0];
  userRole = role;
  setRoleBadge(role, addr);

  if (role === "issuer") {
    showView("viewIssuer");
    renderPendingReissues(addr);
  } else if (role === "student") {
    showView("viewStudent");
    renderStudentDashboard(addr).catch((e) => {
      const el = document.getElementById("studentCreds");
      if (el) el.innerHTML = `<div class="empty-state">Error: ${errMsg(e)}</div>`;
    });
  } else {
    showView("viewVerifier");
  }
}

function populateSchoolSelect(): void {
  // signupSchool is a free-text <input> by default. Only populate if a project
  // swaps it back to a <select> and MOCK_SCHOOLS has preset names.
  const sel = document.getElementById("signupSchool");
  if (!(sel instanceof HTMLSelectElement) || sel.options.length > 0) return;
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
  for (const prefix of ["issue", "revoke", "verify", "reissue"]) {
    fillSelect(`${prefix}Level`, DEGREE_LEVELS, "Select level…");
    fillSelect(`${prefix}Dept`,  DEPARTMENTS,   "Select department…");
    refreshMajors(prefix); // initialize datalist (empty until dept chosen)
  }
}

// Show viewCreateAccount with one of its three sub-panels visible.
function showCreateAccount(mode: "form" | "pending" | "rejected"): void {
  showView("viewCreateAccount");
  const form = document.getElementById("signupFormWrap");
  const pend = document.getElementById("signupPendingWrap");
  const rej  = document.getElementById("signupRejectedWrap");
  if (form) form.style.display = mode === "form"     ? "block" : "none";
  if (pend) pend.style.display = mode === "pending"  ? "block" : "none";
  if (rej)  rej.style.display  = mode === "rejected" ? "block" : "none";
}

// Toggle the Student/School sub-forms based on the selected role radio.
function toggleSignupRole(): void {
  const role = (document.querySelector('input[name="signupRole"]:checked') as HTMLInputElement | null)?.value ?? "student";
  const studentForm = document.getElementById("signupStudentForm");
  const schoolForm  = document.getElementById("signupSchoolForm");
  if (studentForm) studentForm.style.display = role === "student" ? "block" : "none";
  if (schoolForm)  schoolForm.style.display  = role === "school"  ? "block" : "none";
}

// From the "rejected" panel: jump back to the form with the rejected role preselected.
function reapply(): void {
  const radio = document.querySelector(
    `input[name="signupRole"][value="${lastRejectedRole}"]`) as HTMLInputElement | null;
  if (radio) radio.checked = true;
  toggleSignupRole();
  showCreateAccount("form");
}

// Pull the latest on-chain rejection reason for the given role and show it.
async function loadRejectionReason(addr: string, role: "student" | "school"): Promise<void> {
  if (!registry) return;
  try {
    const filter = role === "student"
      ? (registry as Contract).filters.StudentRequestRejected(addr)
      : (registry as Contract).filters.IssuerRequestRejected(addr);
    const logs = await (registry as Contract).queryFilter(filter, 0, "latest");
    const last = logs[logs.length - 1] as EventLog | undefined;
    const reason = last?.args?.reason as string | undefined;
    if (reason) setText("signupRejectedReason", `Reason: ${reason}`);
  } catch (e) {
    console.warn("loadRejectionReason:", errMsg(e));
  }
}

async function submitCreateAccount(btn: HTMLButtonElement): Promise<void> {
  const role = (document.querySelector('input[name="signupRole"]:checked') as HTMLInputElement | null)?.value ?? "student";
  if (role === "school") {
    await submitSchoolApplication(btn);
    return;
  }
  setLoading(btn, true);
  try {
    if (!connectedAddr) throw new Error("Wallet not connected.");
    await ensureConnected();
    const name    = getVal("signupName");
    const school  = getVal("signupSchool");
    const contact = getVal("signupContact");
    if (!name)   throw new Error("Enter your name.");
    if (!school) throw new Error("Enter your school.");

    // Local copy for display only — the admin gates access on-chain.
    localStorage.setItem(
      profileKey(connectedAddr),
      JSON.stringify({ name, school, createdAt: Date.now() }),
    );

    setResult("signupResult", "pending", "⬆ Pinning application metadata…");
    const meta = { version: 1, name, school, contact, appliedAt: new Date().toISOString() };
    const jsonCid = await uploadJsonToPinata(meta, `dacs-student-app-${connectedAddr}`);

    setResult("signupResult", "pending", "⏳ Submitting application on-chain…");
    const tx = await (registry as Contract).requestStudent(`ipfs://${jsonCid}`);
    await tx.wait();

    setResult("signupResult", "success", "✅ Application submitted. Routing…");
    await detectAndRoute(connectedAddr);
  } catch (e) {
    setResult("signupResult", "error", `❌ ${errMsg(e)}`);
  } finally {
    setLoading(btn, false);
  }
}

// School self-serve application: upload doc + metadata to IPFS, then record the
// request on-chain via requestIssuer. The owner reviews it from the Issuer dash.
async function submitSchoolApplication(btn: HTMLButtonElement): Promise<void> {
  setLoading(btn, true);
  try {
    if (!connectedAddr) throw new Error("Wallet not connected.");
    await ensureConnected();
    const name    = getVal("applySchoolName");
    const contact = getVal("applyContact");
    const note    = getVal("applyNote");
    const docFile = (document.getElementById("applyDoc") as HTMLInputElement | null)?.files?.[0] ?? null;
    if (!name)    throw new Error("Enter the institution name.");
    if (!contact) throw new Error("Enter a contact email.");
    if (!docFile) throw new Error("Attach a supporting PDF document.");

    setResult("signupResult", "pending", "⬆ Uploading supporting document to IPFS…");
    const docCid = await uploadToPinata(docFile);

    setResult("signupResult", "pending", "⬆ Pinning application metadata…");
    const meta = { version: 1, name, contact, note, docCid, appliedAt: new Date().toISOString() };
    const jsonCid = await uploadJsonToPinata(meta, `dacs-issuer-app-${connectedAddr}`);

    setResult("signupResult", "pending", "⏳ Submitting application on-chain…");
    const tx = await (registry as Contract).requestIssuer(`ipfs://${jsonCid}`);
    await tx.wait();

    setResult("signupResult", "success", "✅ Application submitted. Routing…");
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

    let pdfCid: string;
    try {
      pdfCid = await uploadToPinata(pdfFile);
    } catch (uploadErr) {
      throw new Error(`Upload failed: ${errMsg(uploadErr)}`);
    }

    // Phase 4 sidecar — record the rich field set off-chain (the hash alone
    // can't recover degreeType). Student/Verifier dashboards read this to
    // render a human-readable title for each credential.
    setResult("issueResult", "pending", `📎 Pinning metadata sidecar…`);
    const level     = getVal("issueLevel");
    const major     = getVal("issueMajor");
    const dept      = getVal("issueDept");
    const studentId = getVal("issueStudentId");
    let jsonCid: string;
    try {
      jsonCid = await uploadJsonToPinata(
        {
          version:    1,
          level, major, dept, studentId,
          degreeType: composed,
          gradDate,
          pdfCid,
          pinnedAt:   new Date().toISOString(),
        },
        `dacs-cred-${studentAddr.slice(0, 8)}-${level}-${major}`,
      );
    } catch (sidecarErr) {
      throw new Error(`Sidecar pin failed: ${errMsg(sidecarErr)}`);
    }

    const metadataURI = `ipfs://${jsonCid}`;
    setResult("issueResult", "pending", `⛓ Submitting to Sepolia… JSON CID: ${jsonCid.slice(0, 12)}…`);

    const credHash = computeCredentialHash(studentAddr, composed, gradDate);
    const tx = await (credential as Contract).issueCredential(studentAddr, credHash, metadataURI);
    setResult("issueResult", "pending", `⏳ Pending… ${txLink(tx.hash)}`);
    await tx.wait();

    setResult(
      "issueResult",
      "success",
      `✅ Issued!<br>` +
      `PDF: <a href="${PINATA_GATEWAY}${pdfCid}"  target="_blank" rel="noopener">${pdfCid.slice(0, 14)}…</a><br>` +
      `Sidecar: <a href="${PINATA_GATEWAY}${jsonCid}" target="_blank" rel="noopener">${jsonCid.slice(0, 14)}…</a><br>` +
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

// ─── Credential metadata (Phase 4 sidecar w/ legacy PDF fallback) ────────────

type CredMeta =
  | { kind: "json"; level: string; major: string; dept: string; studentId: string;
      degreeType: string; gradDate: string; pdfCid: string; }
  | { kind: "pdf-legacy"; pdfCid: string; }
  | { kind: "empty" }
  | { kind: "error"; message: string };

async function fetchCredentialMetadata(uri: string): Promise<CredMeta> {
  if (!uri)                       return { kind: "empty" };
  if (!uri.startsWith("ipfs://")) return { kind: "error", message: `Unexpected URI scheme: ${uri}` };

  const cid = uri.replace("ipfs://", "");
  try {
    const r = await fetch(`${PINATA_GATEWAY}${cid}`);
    if (!r.ok) return { kind: "error", message: `IPFS fetch failed (${r.status})` };

    // Peek the first non-whitespace byte. JSON sidecars start with `{`,
    // PDFs start with `%PDF-`. Fetching everything as text and JSON-parsing
    // works either way, but we avoid loading multi-MB PDFs as text by
    // sniffing a small slice first.
    const blob = await r.blob();
    const head = await blob.slice(0, 8).text();

    if (head.trim().startsWith("{")) {
      try {
        const data = JSON.parse(await blob.text()) as Record<string, unknown>;
        if (typeof data.pdfCid === "string" && data.pdfCid.length > 0) {
          return {
            kind:       "json",
            level:      String(data.level     ?? ""),
            major:      String(data.major     ?? ""),
            dept:       String(data.dept      ?? ""),
            studentId:  String(data.studentId ?? ""),
            degreeType: String(data.degreeType?? ""),
            gradDate:   String(data.gradDate  ?? ""),
            pdfCid:     data.pdfCid,
          };
        }
      } catch {
        /* fall through to legacy treatment */
      }
    }

    // Treat as direct PDF reference (legacy creds issued before the JSON sidecar).
    return { kind: "pdf-legacy", pdfCid: cid };
  } catch (e) {
    return { kind: "error", message: errMsg(e) };
  }
}

function cardTitleFromMeta(
  meta: CredMeta,
  credHash: string,
  extras: { pinName?: string | null; localLabel?: string | null } = {},
): { title: string; subtitle: string } {
  // JSON sidecar wins — full structured degree label.
  if (meta.kind === "json") {
    const level = meta.level || "Degree";
    const major = meta.major || "—";
    const dept  = meta.dept ? ` · ${meta.dept}` : "";
    const sid   = meta.studentId ? ` · Student ID ${meta.studentId}` : "";
    return {
      title:    `${level} of ${major}`,
      subtitle: `${dept.slice(3)}${sid}`,
    };
  }
  // Holder-typed local override (Phase 5).
  if (extras.localLabel) {
    return {
      title:    extras.localLabel,
      subtitle: "Custom label · click ✎ to edit",
    };
  }
  // Recovered Pinata pin filename (Phase 5).
  if (extras.pinName) {
    return {
      title:    extras.pinName,
      subtitle: "From original PDF filename · click ✎ to edit",
    };
  }
  // Hash fallback.
  return {
    title:    `Credential ${credHash.slice(0, 10)}…${credHash.slice(-6)}`,
    subtitle: "Legacy credential — click ✎ to add a label or issue a new one.",
  };
}

// ─── STUDENT DASHBOARD (Phase 3) ─────────────────────────────────────────────

function shortHash(credHash: string): string {
  // 10 hex chars after the 0x prefix — used as a stable DOM id suffix per card.
  return credHash.slice(2, 12);
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// Resolve an issuer wallet to its school name from the on-chain issuer application
// (IssuerRequested → IPFS metadata). Falls back to the short address when there is
// no application, no name, or the registry is unavailable. Cached per issuer.
const schoolNameCache = new Map<string, string>(); // issuerLower -> display name

async function resolveSchoolName(issuerAddr: string): Promise<string> {
  const key = issuerAddr.toLowerCase();
  const cached = schoolNameCache.get(key);
  if (cached !== undefined) return cached;

  let name = shortAddr(issuerAddr); // fallback
  if (registry) {
    try {
      const logs = await (registry as Contract).queryFilter(
        (registry as Contract).filters.IssuerRequested(issuerAddr), 0, "latest");
      const last = logs[logs.length - 1] as EventLog | undefined;
      const uri = last?.args?.metadataURI as string | undefined;
      if (uri) {
        const cid = uri.replace(/^ipfs:\/\//, "");
        const res = await fetch(`${PINATA_GATEWAY}${cid}`);
        if (res.ok) {
          const meta = (await res.json()) as { name?: string };
          if (meta.name && meta.name.trim()) name = meta.name.trim();
        }
      }
    } catch (e) {
      console.warn(`resolveSchoolName(${issuerAddr.slice(0, 10)}…):`, errMsg(e));
    }
  }
  schoolNameCache.set(key, name);
  return name;
}

async function renderStudentDashboard(addr: string): Promise<void> {
  const container = document.getElementById("studentCreds");
  if (!container) return;
  if (!credential || !provider) {
    container.innerHTML = `<div class="empty-state">Wallet not connected.</div>`;
    return;
  }

  // Greeting from localStorage signup profile (if any)
  const profileRaw = localStorage.getItem(profileKey(addr));
  if (profileRaw) {
    try {
      const p = JSON.parse(profileRaw) as { name?: string; school?: string };
      if (p.name)   setText("studentGreeting", `Welcome, ${p.name}`);
      if (p.school) setText("studentSubtitle", `${p.school} · ${addr.slice(0, 6)}…${addr.slice(-4)}`);
    } catch {
      /* profile JSON corrupted — keep default greeting */
    }
  } else {
    setText("studentSubtitle", `${addr.slice(0, 6)}…${addr.slice(-4)}`);
  }

  // Issued credentials where this wallet is the holder
  let issuedLogs: EventLog[] = [];
  try {
    const filter = (credential as Contract).filters.CredentialIssued(null, null, addr);
    issuedLogs   = (await (credential as Contract).queryFilter(filter, 0, "latest")) as EventLog[];
  } catch (e) {
    container.innerHTML = `<div class="empty-state">Failed to load credentials: ${errMsg(e)}</div>`;
    return;
  }

  if (issuedLogs.length === 0) {
    container.innerHTML = `<div class="empty-state">No credentials issued to this wallet yet.</div>`;
    return;
  }

  // Sort earliest issued first (by blockNumber, then logIndex as tiebreaker)
  issuedLogs.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
    return (a.index ?? 0) - (b.index ?? 0);
  });

  // Revocation status per credHash (parallel)
  const revokedSet = new Set<string>();
  await Promise.all(issuedLogs.map(async (ev) => {
    const h = ev.args[0] as string;
    try {
      const revFilter = (credential as Contract).filters.CredentialRevoked(h);
      const revLogs   = await (credential as Contract).queryFilter(revFilter, 0, "latest");
      if (revLogs.length > 0) revokedSet.add(h);
    } catch (e) {
      console.warn(`Revoke check for ${h.slice(0, 10)}… failed:`, errMsg(e));
    }
  }));

  // Issued block timestamps (parallel)
  const issuedDates = await Promise.all(issuedLogs.map(async (ev) => {
    try {
      const block = await provider!.getBlock(ev.blockNumber);
      return block ? formatTs(Number(block.timestamp)) : "Unknown";
    } catch {
      return "Unknown";
    }
  }));

  // Sidecar metadata (parallel) — falls back to legacy/hash title on failure
  const metas: CredMeta[] = await Promise.all(issuedLogs.map(async (ev) => {
    const h = ev.args[0] as string;
    try {
      const uri: string = await (credential as Contract).getMetadataURI(h);
      return await fetchCredentialMetadata(uri);
    } catch (e) {
      console.warn(`Metadata fetch for ${h.slice(0, 10)}… failed:`, errMsg(e));
      return { kind: "error", message: errMsg(e) };
    }
  }));

  // Pinata pin filename recovery for non-JSON metas (Phase 5).
  // Only pdf-legacy has a known CID; empty/error kinds skip the API call.
  const pinNames: (string | null)[] = await Promise.all(metas.map(async (m) => {
    if (m.kind === "pdf-legacy") return await fetchPinName(m.pdfCid);
    return null;
  }));

  // Build one credential card element (closes over the precomputed arrays).
  const buildCard = (ev: EventLog, i: number): HTMLElement => {
    const credHash   = ev.args[0] as string;
    const issuerAddr = ev.args[1] as string;
    const isRevoked  = revokedSet.has(credHash);
    const sh         = shortHash(credHash);
    const issuedDate = issuedDates[i];
    const meta       = metas[i];
    const pinName    = pinNames[i];
    const localLabel = localStorage.getItem(`dacs:credLabel:${credHash.toLowerCase()}`);
    const pendingReq = findReissueByCredHash(credHash);
    const { title, subtitle } = cardTitleFromMeta(meta, credHash, { pinName, localLabel });

    // ✎ button shown only when the title is derived from non-sidecar sources
    // (i.e. the holder can override). For sidecar-backed creds the title is
    // already authoritative.
    const showLabelEdit = meta.kind !== "json";
    const labelBtn      = showLabelEdit
      ? `<button class="btn-label-edit" onclick="toggleLabelEdit('${credHash}')" title="Edit local label">✎</button>`
      : "";
    const labelEditRow  = showLabelEdit
      ? `<div id="labelEdit_${sh}" class="label-edit" style="display:none">
           <input id="labelInput_${sh}" maxlength="80" placeholder="e.g., Bachelor of CS · 2024" value="${escapeHtml(localLabel ?? "")}" />
           <button class="btn-holder" onclick="saveLocalLabel('${credHash}', this)">Save</button>
           <button class="btn-mail"   onclick="toggleLabelEdit('${credHash}')">Cancel</button>
         </div>`
      : "";

    // Phase 6 — pending / approved / rejected reissue badges.
    let reissueBadge = "";
    if (pendingReq?.status === "pending") {
      reissueBadge = `<span class="dash-badge pending" style="margin-left:8px">⏳ Reissue Pending</span>`;
    } else if (pendingReq?.status === "approved") {
      reissueBadge = `<span class="dash-badge ok" style="margin-left:8px">✓ Reissued — see new cred</span>`;
    } else if (pendingReq?.status === "rejected") {
      reissueBadge = `<span class="dash-badge warn" style="margin-left:8px" title="${escapeHtml(pendingReq.rejectReason ?? "")}">✗ Reissue Rejected</span>`;
    }
    const reissueBtnDisabled = pendingReq?.status === "pending" ? "disabled" : "";

    const card = document.createElement("div");
    card.className = `cred-card${isRevoked ? " revoked" : ""}`;
    card.dataset.hash = credHash;
    card.innerHTML = `
      <div class="cred-title">
        <div>
          <h4>${escapeHtml(title)} ${labelBtn}</h4>
          <div class="cred-subtitle">${escapeHtml(subtitle)}</div>
        </div>
        <div>
          ${isRevoked
            ? `<span class="dash-badge warn">✗ Revoked</span>`
            : `<span class="dash-badge ok">✓ Active</span>`}
          ${reissueBadge}
        </div>
      </div>
      ${labelEditRow}
      <div class="cred-meta">
        <span class="k">Issued</span><span class="v">${issuedDate}</span>
        ${meta.kind === "json" && meta.gradDate ? `<span class="k">Graduated</span><span class="v">${meta.gradDate}</span>` : ""}
        <span class="k">Issuer</span><span class="v cred-hash">${issuerAddr}</span>
        <span class="k">Hash</span><span class="v cred-hash">${credHash}</span>
      </div>
      <div class="cred-actions">
        <button class="btn-dl"     onclick="studentDownload('${credHash}', this)">⬇ Download PDF</button>
        <button class="btn-holder" onclick="toggleGrantForm('${sh}')">⛓ Manage Access</button>
        <button class="btn-mail"   onclick="requestReissuance('${credHash}', '${issuerAddr}')" ${reissueBtnDisabled}>✉ Request Re-issuance</button>
      </div>
      <div id="grantForm_${sh}" class="cred-grant-form">
        <input id="grantVerifier_${sh}" placeholder="Verifier address 0x…" />
        <button class="btn-holder" onclick="studentGrantAccess('${credHash}', this)">Grant</button>
        <button class="btn-issuer" onclick="studentRevokeAccess('${credHash}', this)">Revoke</button>
      </div>
      <div id="cardResult_${sh}" class="result"></div>
    `;
    return card;
  };

  // Group credentials by issuing school, preserving earliest-first order.
  const groups = new Map<string, number[]>(); // issuerLower -> indices into issuedLogs
  issuedLogs.forEach((ev, i) => {
    const key = (ev.args[1] as string).toLowerCase();
    const arr = groups.get(key);
    if (arr) arr.push(i);
    else groups.set(key, [i]);
  });

  // Resolve a display name per unique issuer (cached, parallel).
  const issuerKeys = [...groups.keys()];
  const names = await Promise.all(
    issuerKeys.map((k) => resolveSchoolName(issuedLogs[groups.get(k)![0]].args[1] as string)),
  );

  container.innerHTML = "";
  issuerKeys.forEach((key, gi) => {
    const indices    = groups.get(key)!;
    const issuerAddr = issuedLogs[indices[0]].args[1] as string;

    const group = document.createElement("div");
    group.className = "cred-school-group";

    const head = document.createElement("h3");
    head.className = "cred-school-head";
    head.innerHTML =
      `🏛 ${escapeHtml(names[gi])} <span class="cred-school-addr">${escapeHtml(shortAddr(issuerAddr))}</span>`;
    group.appendChild(head);

    for (const i of indices) group.appendChild(buildCard(issuedLogs[i], i));
    container.appendChild(group);
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toggleLabelEdit(credHash: string): void {
  const sh   = shortHash(credHash);
  const row  = document.getElementById(`labelEdit_${sh}`);
  if (!row) return;
  row.style.display = row.style.display === "none" ? "flex" : "none";
}

function saveLocalLabel(credHash: string, btn: HTMLButtonElement): void {
  const sh    = shortHash(credHash);
  const input = document.getElementById(`labelInput_${sh}`) as HTMLInputElement | null;
  if (!input) return;
  const value = input.value.trim();
  const key   = `dacs:credLabel:${credHash.toLowerCase()}`;
  setLoading(btn, true);
  try {
    if (value.length === 0) {
      localStorage.removeItem(key);
    } else if (value.length > 80) {
      setResult(`cardResult_${sh}`, "error", "❌ Label must be 80 characters or fewer.");
      return;
    } else {
      localStorage.setItem(key, value);
    }
    renderStudentDashboard(connectedAddr).catch((e) => {
      console.error("Dashboard re-render failed:", errMsg(e));
    });
  } finally {
    setLoading(btn, false);
  }
}

function toggleGrantForm(short: string): void {
  const form = document.getElementById(`grantForm_${short}`);
  if (form) form.classList.toggle("show");
}

async function studentDownload(credHash: string, btn: HTMLButtonElement): Promise<void> {
  const sh = shortHash(credHash);
  setLoading(btn, true);
  setResult(`cardResult_${sh}`, "pending", "🔍 Resolving IPFS metadata…");
  try {
    await ensureConnected();
    const uri: string = await (credential as Contract).getMetadataURI(credHash);
    const meta        = await fetchCredentialMetadata(uri);

    let pdfCid: string;
    if (meta.kind === "json" || meta.kind === "pdf-legacy") {
      pdfCid = meta.pdfCid;
    } else if (meta.kind === "empty") {
      throw new Error("No diploma attached to this credential.");
    } else {
      throw new Error(meta.message);
    }

    const url = `${PINATA_GATEWAY}${pdfCid}`;
    setResult(`cardResult_${sh}`, "pending", "📥 Downloading PDF from IPFS…");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`IPFS fetch failed (${response.status}).`);

    const blob      = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a         = document.createElement("a");
    a.href          = objectUrl;
    a.download      = `diploma_${sh}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);

    setResult(`cardResult_${sh}`, "success",
      `✅ Downloaded!<br><a href="${url}" target="_blank" rel="noopener">View on IPFS: ${pdfCid.slice(0, 16)}…</a>`);
  } catch (e) {
    setResult(`cardResult_${sh}`, "error", `❌ ${errMsg(e)}`);
  } finally {
    setLoading(btn, false);
  }
}

async function studentGrantAccess(credHash: string, btn: HTMLButtonElement): Promise<void> {
  const sh = shortHash(credHash);
  setLoading(btn, true);
  try {
    await ensureConnected();
    const verifier = getVal(`grantVerifier_${sh}`);
    if (!verifier)            throw new Error("Enter a verifier address.");
    if (!isAddress(verifier)) throw new Error(`Invalid verifier address: "${verifier}".`);
    const tx = await (credential as Contract).grantVerifierAccess(credHash, verifier);
    setResult(`cardResult_${sh}`, "pending", `⏳ Pending… ${txLink(tx.hash)}`);
    await tx.wait();
    setResult(`cardResult_${sh}`, "success",
      `✅ Access granted to ${verifier.slice(0, 8)}… ${txLink(tx.hash)}`);
  } catch (e) {
    setResult(`cardResult_${sh}`, "error", `❌ ${errMsg(e)}`);
  } finally {
    setLoading(btn, false);
  }
}

async function studentRevokeAccess(credHash: string, btn: HTMLButtonElement): Promise<void> {
  const sh = shortHash(credHash);
  setLoading(btn, true);
  try {
    await ensureConnected();
    const verifier = getVal(`grantVerifier_${sh}`);
    if (!verifier)            throw new Error("Enter a verifier address.");
    if (!isAddress(verifier)) throw new Error(`Invalid verifier address: "${verifier}".`);
    const tx = await (credential as Contract).revokeVerifierAccess(credHash, verifier);
    setResult(`cardResult_${sh}`, "pending", `⏳ Pending… ${txLink(tx.hash)}`);
    await tx.wait();
    setResult(`cardResult_${sh}`, "success",
      `✅ Access revoked for ${verifier.slice(0, 8)}… ${txLink(tx.hash)}`);
  } catch (e) {
    setResult(`cardResult_${sh}`, "error", `❌ ${errMsg(e)}`);
  } finally {
    setLoading(btn, false);
  }
}

// ─── Phase 6: Reissuance request flow ─────────────────────────────────────────
//
// Replaces the previous mailto flow. Opens a modal prefilled from the current
// sidecar (or blank for legacy creds). Submission writes to the localStorage
// queue; the issuer dashboard picks it up on the next login.

let currentReissueSidecar: { level?: string; major?: string; dept?: string; studentId?: string; gradDate?: string } = {};

async function requestReissuance(credHash: string, issuerAddr: string): Promise<void> {
  const modal = document.getElementById("reissueModal");
  if (!modal) return;

  // Reset
  (document.getElementById("reissueCredHash")   as HTMLInputElement).value = credHash;
  (document.getElementById("reissueIssuerAddr") as HTMLInputElement).value = issuerAddr;
  (document.getElementById("reissuePdfCid")     as HTMLInputElement).value = "";
  (document.getElementById("reissueReason")     as HTMLTextAreaElement).value = "";
  setResult("reissueModalResult", "pending", "🔎 Loading current credential details…");
  modal.classList.add("show");

  currentReissueSidecar = {};

  // Best-effort prefill from current sidecar
  try {
    if (!credential) throw new Error("Wallet not connected.");
    const uri  = await (credential as Contract).getMetadataURI(credHash);
    const meta = await fetchCredentialMetadata(uri);
    if (meta.kind === "json") {
      currentReissueSidecar = {
        level:     meta.level,
        major:     meta.major,
        dept:      meta.dept,
        studentId: meta.studentId,
        gradDate:  meta.gradDate,
      };
      (document.getElementById("reissuePdfCid")    as HTMLInputElement).value = meta.pdfCid;
      (document.getElementById("reissueLevel")     as HTMLSelectElement).value = meta.level   ?? "";
      (document.getElementById("reissueDept")      as HTMLSelectElement).value = meta.dept    ?? "";
      refreshMajors("reissue");
      (document.getElementById("reissueMajor")     as HTMLInputElement).value = meta.major     ?? "";
      (document.getElementById("reissueStudentId") as HTMLInputElement).value = meta.studentId ?? "";
      (document.getElementById("reissueGradDate")  as HTMLInputElement).value = meta.gradDate  ?? "";
      setResult("reissueModalResult", "success", "✅ Loaded current fields — edit any value, then submit.");
    } else if (meta.kind === "pdf-legacy") {
      (document.getElementById("reissuePdfCid")    as HTMLInputElement).value = meta.pdfCid;
      setResult("reissueModalResult", "pending",
        "⚠️ Legacy credential — no structured fields stored. Fill in the new fields below.");
    } else {
      setResult("reissueModalResult", "pending", "⚠️ No sidecar found — fill in the new fields below.");
    }
  } catch (e) {
    setResult("reissueModalResult", "error", `⚠️ Could not prefill: ${errMsg(e)}. Fill in manually.`);
  }
}

function closeReissueModal(): void {
  const modal = document.getElementById("reissueModal");
  if (modal) modal.classList.remove("show");
}

function submitReissueRequest(btn: HTMLButtonElement): void {
  setLoading(btn, true);
  try {
    const credHash   = (document.getElementById("reissueCredHash")   as HTMLInputElement).value;
    const issuerAddr = (document.getElementById("reissueIssuerAddr") as HTMLInputElement).value;
    const pdfCid     = (document.getElementById("reissuePdfCid")     as HTMLInputElement).value;
    const reason     = (document.getElementById("reissueReason")     as HTMLTextAreaElement).value.trim();
    const level      = (document.getElementById("reissueLevel")      as HTMLSelectElement).value;
    const dept       = (document.getElementById("reissueDept")       as HTMLSelectElement).value;
    const major      = (document.getElementById("reissueMajor")      as HTMLInputElement).value.trim();
    const studentId  = (document.getElementById("reissueStudentId")  as HTMLInputElement).value.trim();
    const gradDate   = (document.getElementById("reissueGradDate")   as HTMLInputElement).value;

    if (!credHash || !issuerAddr) throw new Error("Missing credential identifiers.");
    if (reason.length < 10)       throw new Error("Reason must be at least 10 characters.");
    if (!level)                   throw new Error("Pick a degree level.");
    if (!dept)                    throw new Error("Pick a department.");
    if (!major)                   throw new Error("Enter a major.");
    if (!studentId)               throw new Error("Enter a student ID.");
    if (!gradDate)                throw new Error("Pick a graduation date.");

    // Reject pipe characters that would collide with the degreeType separator.
    for (const [name, v] of [["level", level], ["dept", dept], ["major", major], ["studentId", studentId]] as const) {
      if (v.includes("|")) throw new Error(`Field "${name}" cannot contain the | character.`);
    }

    // Require at least one field to differ from the current sidecar — otherwise
    // the new hash would collide with the existing on-chain hash.
    const cur = currentReissueSidecar;
    if (cur.level !== undefined) {
      const same =
        cur.level === level &&
        cur.dept  === dept  &&
        cur.major === major &&
        cur.studentId === studentId &&
        cur.gradDate  === gradDate;
      if (same) throw new Error("Edit at least one field — the new credential needs a different hash.");
    }

    const id: string = `${Date.now()}-${credHash.slice(2, 10)}`;
    const req: ReissueReq = {
      id,
      credHash,
      holderAddr:  connectedAddr,
      issuerAddr,
      pdfCid:      pdfCid || "",
      requestedAt: Date.now(),
      reason,
      newFields:   { level, major, dept, studentId, gradDate },
      status:      "pending",
    };
    addReissueRequest(req);

    setResult("reissueModalResult", "success", "✅ Submitted. Issuer will process this on next login.");
    setTimeout(() => {
      closeReissueModal();
      renderStudentDashboard(connectedAddr).catch((e) => {
        console.error("Dashboard re-render failed:", errMsg(e));
      });
    }, 700);
  } catch (e) {
    setResult("reissueModalResult", "error", `❌ ${errMsg(e)}`);
  } finally {
    setLoading(btn, false);
  }
}

// ─── Phase 6: Issuer-side pending requests panel ──────────────────────────────

function renderPendingReissues(addr: string): void {
  const container = document.getElementById("pendingReissuesList");
  if (!container) return;

  const pending = listPendingReissuesForIssuer(addr);
  if (pending.length === 0) {
    container.className = "empty-state";
    container.textContent = "No pending requests.";
    return;
  }

  container.className = "";
  container.innerHTML = "";
  for (const req of pending) {
    const f         = req.newFields;
    const holderTxt = `${req.holderAddr.slice(0, 8)}…${req.holderAddr.slice(-4)}`;
    const credShort = `${req.credHash.slice(0, 10)}…${req.credHash.slice(-6)}`;
    const ageMin    = Math.max(0, Math.round((Date.now() - req.requestedAt) / 60000));
    const pdfNote   = req.pdfCid
      ? `Original PDF: <span class="cred-hash">${req.pdfCid}</span>`
      : `<strong style="color: var(--error-b)">⚠️ Legacy credential — issuer must upload a fresh PDF on approval.</strong>`;

    const card = document.createElement("div");
    card.className = "reissue-req-card";
    card.id        = `reissueReqCard_${req.id}`;
    card.innerHTML = `
      <div class="rr-head">
        <div>
          <strong>From ${escapeHtml(holderTxt)}</strong>
          <div style="font-size:0.72rem; color: var(--muted)">${ageMin} min ago</div>
        </div>
        <span class="dash-badge pending">⏳ Pending</span>
      </div>
      <div class="rr-reason"><em>"${escapeHtml(req.reason)}"</em></div>
      <div class="rr-fields">
        <span class="k">Original</span><span class="v cred-hash">${credShort}</span>
        <span class="k">Level</span><span>${escapeHtml(f.level)}</span>
        <span class="k">Dept</span><span>${escapeHtml(f.dept)}</span>
        <span class="k">Major</span><span>${escapeHtml(f.major)}</span>
        <span class="k">Student ID</span><span>${escapeHtml(f.studentId)}</span>
        <span class="k">Grad Date</span><span>${escapeHtml(f.gradDate)}</span>
        <span class="k">PDF</span><span>${pdfNote}</span>
      </div>
      <div class="rr-actions">
        <button class="btn-issuer" onclick="approveReissue('${req.id}', this)">✓ Approve & Reissue</button>
        <button class="btn-mail"   onclick="rejectReissue('${req.id}', this)">✗ Reject</button>
      </div>
      <div id="reissueReqResult_${req.id}" class="result"></div>
    `;
    container.appendChild(card);
  }
}

async function pickFreshPdf(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type   = "file";
    input.accept = ".pdf";
    input.onchange = () => {
      const f = input.files?.[0] ?? null;
      resolve(f);
    };
    input.click();
    // If the dialog is dismissed, onchange never fires — caller relies on the
    // user clicking Approve again. Acceptable for a one-click demo flow.
  });
}

async function approveReissue(reqId: string, btn: HTMLButtonElement): Promise<void> {
  const resultId = `reissueReqResult_${reqId}`;
  setLoading(btn, true);
  try {
    await ensureConnected();

    const all = listPendingReissuesForIssuer(connectedAddr).filter((r) => r.id === reqId);
    const req = all[0];
    if (!req) throw new Error("Request not found or no longer pending.");

    const f          = req.newFields;
    const degreeType = `${f.level}|${f.major}|${f.dept}|${f.studentId}`;
    const newHash    = computeCredentialHash(req.holderAddr, degreeType, f.gradDate);
    if (newHash.toLowerCase() === req.credHash.toLowerCase()) {
      throw new Error("New fields produce the same hash as the original — request rejected by hash check.");
    }

    // Legacy: must upload a fresh PDF before pinning the sidecar.
    let pdfCid = req.pdfCid;
    if (!pdfCid) {
      setResult(resultId, "pending", "📎 Pick a PDF to attach to the reissued credential…");
      const file = await pickFreshPdf();
      if (!file) throw new Error("No PDF selected — approval cancelled.");
      setResult(resultId, "pending", `⬆ Uploading new PDF to IPFS (${file.name})…`);
      pdfCid = await uploadToPinata(file);
    }

    // Pin sidecar
    setResult(resultId, "pending", "⬆ Pinning new JSON sidecar to IPFS…");
    const sidecar = {
      version:        1,
      level:          f.level,
      major:          f.major,
      dept:           f.dept,
      studentId:      f.studentId,
      degreeType,
      gradDate:       f.gradDate,
      pdfCid,
      pinnedAt:       new Date().toISOString(),
      reissuedFrom:   req.credHash,
    };
    const jsonCid = await uploadJsonToPinata(sidecar, `dacs-reissue-${reqId}`);

    // Revoke old (skip if already revoked)
    setResult(resultId, "pending", "⏳ Revoking old credential…");
    try {
      const tx1 = await (credential as Contract).revokeCredential(req.credHash);
      await tx1.wait();
    } catch (e) {
      const msg = errMsg(e);
      if (!/already revoked/i.test(msg) && !/CredentialAlreadyRevoked/i.test(msg)) {
        throw new Error(`Revoke failed: ${msg}`);
      }
      console.warn("Old credential already revoked — continuing.");
    }

    // Issue new
    setResult(resultId, "pending", "⏳ Issuing new credential…");
    const tx2 = await (credential as Contract).issueCredential(
      req.holderAddr,
      newHash,
      `ipfs://${jsonCid}`,
    );
    await tx2.wait();

    updateReissueRequest(reqId, {
      status:      "approved",
      newCredHash: newHash,
      newTxHash:   tx2.hash,
    });

    setResult(resultId, "success",
      `✅ Reissued. New hash <span class="cred-hash">${newHash.slice(0, 14)}…</span> ${txLink(tx2.hash)}`);
    // Refresh panel
    renderPendingReissues(connectedAddr);
  } catch (e) {
    setResult(resultId, "error", `❌ ${errMsg(e)}`);
  } finally {
    setLoading(btn, false);
  }
}

function rejectReissue(reqId: string, btn: HTMLButtonElement): void {
  const resultId = `reissueReqResult_${reqId}`;
  const reason = window.prompt("Reason for rejection (shown to the student):", "Insufficient information");
  if (reason === null) return;
  setLoading(btn, true);
  try {
    updateReissueRequest(reqId, {
      status:       "rejected",
      rejectReason: reason.slice(0, 200),
    });
    setResult(resultId, "success", "✓ Request rejected.");
    renderPendingReissues(connectedAddr);
  } finally {
    setLoading(btn, false);
  }
}

// ─── OWNER: Pending school applications ───────────────────────────────────────
// On-chain queue: query IssuerRequested events, keep only those still Pending
// (status==1), fetch each application's IPFS metadata, render Approve/Reject.
async function renderPendingSchoolApps(ownerAddr: string): Promise<void> {
  const container = document.getElementById("pendingSchoolAppsList");
  if (!container || !registry) return;
  void ownerAddr; // applications are global; owner-gated by the section's visibility
  container.className = "empty-state";
  container.textContent = "Loading…";

  try {
    const logs = await (registry as Contract).queryFilter(
      (registry as Contract).filters.IssuerRequested(), 0, "latest");

    // Latest request per applicant (logs come back chronological → last wins).
    const latest = new Map<string, EventLog>();
    for (const log of logs as EventLog[]) {
      const applicant = (log.args?.applicant as string).toLowerCase();
      latest.set(applicant, log);
    }

    // Keep only applications still Pending on-chain.
    const pending: { applicant: string; metadataURI: string }[] = [];
    await Promise.all([...latest.values()].map(async (log) => {
      const applicant = log.args?.applicant as string;
      const status = Number(await (registry as Contract).issuerRequestStatus(applicant));
      if (status === 1) pending.push({ applicant, metadataURI: log.args?.metadataURI as string });
    }));

    if (pending.length === 0) {
      container.className = "empty-state";
      container.textContent = "No pending applications.";
      return;
    }

    const cards = await Promise.all(pending.map(async (p) => {
      let meta: { name?: string; contact?: string; note?: string; docCid?: string } = {};
      try {
        const cid = p.metadataURI.replace(/^ipfs:\/\//, "");
        const res = await fetch(`${PINATA_GATEWAY}${cid}`);
        if (res.ok) meta = await res.json();
      } catch (err) { console.warn("application metadata fetch:", errMsg(err)); }

      const short   = `${p.applicant.slice(0, 8)}…${p.applicant.slice(-4)}`;
      const docLink = meta.docCid
        ? `<a href="${PINATA_GATEWAY}${meta.docCid}" target="_blank" rel="noopener">↗ View document</a>`
        : "—";

      return `
        <div class="reissue-req-card" id="schoolAppCard_${p.applicant}">
          <div class="rr-head">
            <div>
              <strong>${escapeHtml(meta.name ?? "(no name)")}</strong>
              <div style="font-size:0.72rem; color: var(--muted)">${escapeHtml(short)}</div>
            </div>
            <span class="dash-badge pending">⏳ Pending</span>
          </div>
          ${meta.note ? `<div class="rr-reason"><em>"${escapeHtml(meta.note)}"</em></div>` : ""}
          <div class="rr-fields">
            <span class="k">Contact</span><span>${escapeHtml(meta.contact ?? "—")}</span>
            <span class="k">Wallet</span><span class="cred-hash">${escapeHtml(p.applicant)}</span>
            <span class="k">Document</span><span>${docLink}</span>
          </div>
          <div class="rr-actions">
            <button class="btn-issuer" onclick="approveSchoolApp('${p.applicant}', this)">✓ Approve &amp; Register</button>
            <button class="btn-mail"   onclick="rejectSchoolApp('${p.applicant}', this)">✗ Reject</button>
          </div>
          <div id="schoolAppResult_${p.applicant}" class="result"></div>
        </div>`;
    }));

    container.className = "";
    container.innerHTML = cards.join("");
  } catch (e) {
    container.className = "empty-state";
    container.textContent = `Error: ${errMsg(e)}`;
  }
}

async function approveSchoolApp(addr: string, btn: HTMLButtonElement): Promise<void> {
  const resultId = `schoolAppResult_${addr}`;
  setLoading(btn, true);
  try {
    await ensureConnected();
    const tx = await (registry as Contract).registerIssuer(addr);
    setResult(resultId, "pending", `⏳ Registering… ${txLink(tx.hash)}`);
    await tx.wait();
    setResult(resultId, "success", `✅ Registered as issuer. ${txLink(tx.hash)}`);
    renderPendingSchoolApps(connectedAddr);
  } catch (e) {
    const err = e as Error & { revert?: { name: string }; data?: string };
    const isAlreadyReg =
      err.revert?.name === "AlreadyRegistered" ||
      (typeof err.data === "string" && err.data.startsWith("0x45ed80e9"));
    if (isAlreadyReg) {
      setResult(resultId, "success", "✅ Already registered.");
      renderPendingSchoolApps(connectedAddr);
    } else {
      setResult(resultId, "error", `❌ ${errMsg(e)}`);
    }
  } finally {
    setLoading(btn, false);
  }
}

async function rejectSchoolApp(addr: string, btn: HTMLButtonElement): Promise<void> {
  const resultId = `schoolAppResult_${addr}`;
  const reason = window.prompt("Reason for rejection (shown to the applicant):", "Could not verify institution");
  if (reason === null) return;
  setLoading(btn, true);
  try {
    await ensureConnected();
    const tx = await (registry as Contract).rejectIssuerRequest(addr, reason.slice(0, 200));
    setResult(resultId, "pending", `⏳ Rejecting… ${txLink(tx.hash)}`);
    await tx.wait();
    setResult(resultId, "success", "✓ Application rejected.");
    renderPendingSchoolApps(connectedAddr);
  } catch (e) {
    setResult(resultId, "error", `❌ ${errMsg(e)}`);
  } finally {
    setLoading(btn, false);
  }
}

// ─── ADMIN: Pending student applications ──────────────────────────────────────
// On-chain queue: query StudentRequested events, keep only those still Pending
// (status==1), fetch each application's IPFS metadata, render Approve/Reject.
async function renderPendingStudentApps(adminAddr: string): Promise<void> {
  const container = document.getElementById("pendingStudentAppsList");
  if (!container || !registry) return;
  void adminAddr; // applications are global; admin-gated by the view's visibility
  container.className = "empty-state";
  container.textContent = "Loading…";

  try {
    const logs = await (registry as Contract).queryFilter(
      (registry as Contract).filters.StudentRequested(), 0, "latest");

    // Latest request per applicant (logs come back chronological → last wins).
    const latest = new Map<string, EventLog>();
    for (const log of logs as EventLog[]) {
      const applicant = (log.args?.applicant as string).toLowerCase();
      latest.set(applicant, log);
    }

    // Keep only applications still Pending on-chain.
    const pending: { applicant: string; metadataURI: string }[] = [];
    await Promise.all([...latest.values()].map(async (log) => {
      const applicant = log.args?.applicant as string;
      const status = Number(await (registry as Contract).studentRequestStatus(applicant));
      if (status === 1) pending.push({ applicant, metadataURI: log.args?.metadataURI as string });
    }));

    if (pending.length === 0) {
      container.className = "empty-state";
      container.textContent = "No pending applications.";
      return;
    }

    const cards = await Promise.all(pending.map(async (p) => {
      let meta: { name?: string; school?: string; contact?: string } = {};
      try {
        const cid = p.metadataURI.replace(/^ipfs:\/\//, "");
        const res = await fetch(`${PINATA_GATEWAY}${cid}`);
        if (res.ok) meta = await res.json();
      } catch (err) { console.warn("application metadata fetch:", errMsg(err)); }

      const short = `${p.applicant.slice(0, 8)}…${p.applicant.slice(-4)}`;

      return `
        <div class="reissue-req-card" id="studentAppCard_${p.applicant}">
          <div class="rr-head">
            <div>
              <strong>${escapeHtml(meta.name ?? "(no name)")}</strong>
              <div style="font-size:0.72rem; color: var(--muted)">${escapeHtml(short)}</div>
            </div>
            <span class="dash-badge pending">⏳ Pending</span>
          </div>
          <div class="rr-fields">
            <span class="k">School</span><span>${escapeHtml(meta.school ?? "—")}</span>
            <span class="k">Contact</span><span>${escapeHtml(meta.contact || "—")}</span>
            <span class="k">Wallet</span><span class="cred-hash">${escapeHtml(p.applicant)}</span>
          </div>
          <div class="rr-actions">
            <button class="btn-issuer" onclick="approveStudentApp('${p.applicant}', this)">✓ Approve &amp; Register</button>
            <button class="btn-mail"   onclick="rejectStudentApp('${p.applicant}', this)">✗ Reject</button>
          </div>
          <div id="studentAppResult_${p.applicant}" class="result"></div>
        </div>`;
    }));

    container.className = "";
    container.innerHTML = cards.join("");
  } catch (e) {
    container.className = "empty-state";
    container.textContent = `Error: ${errMsg(e)}`;
  }
}

async function approveStudentApp(addr: string, btn: HTMLButtonElement): Promise<void> {
  const resultId = `studentAppResult_${addr}`;
  setLoading(btn, true);
  try {
    await ensureConnected();
    const tx = await (registry as Contract).registerStudent(addr);
    setResult(resultId, "pending", `⏳ Registering… ${txLink(tx.hash)}`);
    await tx.wait();
    setResult(resultId, "success", `✅ Registered as student. ${txLink(tx.hash)}`);
    renderPendingStudentApps(connectedAddr);
  } catch (e) {
    const err = e as Error & { revert?: { name: string }; data?: string };
    const isAlreadyReg =
      err.revert?.name === "AlreadyRegistered" ||
      (typeof err.data === "string" && err.data.startsWith("0x45ed80e9"));
    if (isAlreadyReg) {
      setResult(resultId, "success", "✅ Already registered.");
      renderPendingStudentApps(connectedAddr);
    } else {
      setResult(resultId, "error", `❌ ${errMsg(e)}`);
    }
  } finally {
    setLoading(btn, false);
  }
}

async function rejectStudentApp(addr: string, btn: HTMLButtonElement): Promise<void> {
  const resultId = `studentAppResult_${addr}`;
  const reason = window.prompt("Reason for rejection (shown to the applicant):", "Could not verify enrollment");
  if (reason === null) return;
  setLoading(btn, true);
  try {
    await ensureConnected();
    const tx = await (registry as Contract).rejectStudentRequest(addr, reason.slice(0, 200));
    setResult(resultId, "pending", `⏳ Rejecting… ${txLink(tx.hash)}`);
    await tx.wait();
    setResult(resultId, "success", "✓ Application rejected.");
    renderPendingStudentApps(connectedAddr);
  } catch (e) {
    setResult(resultId, "error", `❌ ${errMsg(e)}`);
  } finally {
    setLoading(btn, false);
  }
}

// ─── ADMIN: Manage admins (multi-admin) ───────────────────────────────────────
// Owner-only management of the admin set. Lists the owner (always admin) plus any
// granted admins, derived from AdminAdded history confirmed against on-chain
// isAdmin(). Add/remove controls render only for the contract owner.
function adminRow(addr: string, isOwnerRow: boolean, viewerIsOwner: boolean): string {
  const short = `${addr.slice(0, 8)}…${addr.slice(-4)}`;
  const badge = isOwnerRow
    ? '<span class="dash-badge success">👑 Owner</span>'
    : '<span class="dash-badge">🛡 Admin</span>';
  const removeBtn = (viewerIsOwner && !isOwnerRow)
    ? `<button class="btn-mail" onclick="removeAdminWallet('${addr}', this)">✗ Remove</button>`
    : "";
  return `
    <div class="reissue-req-card" id="adminRow_${addr}">
      <div class="rr-head">
        <div>
          <strong>${escapeHtml(short)}</strong>
          <div class="cred-hash" style="font-size:0.72rem; color: var(--muted)">${escapeHtml(addr)}</div>
        </div>
        ${badge}
      </div>
      ${removeBtn ? `<div class="rr-actions">${removeBtn}</div>` : ""}
      <div id="adminRowResult_${addr}" class="result"></div>
    </div>`;
}

async function renderManageAdmins(adminAddr: string, isOwner: boolean): Promise<void> {
  const container = document.getElementById("manageAdminsList");
  const addBox    = document.getElementById("manageAdminsAdd");
  const hint      = document.getElementById("manageAdminsHint");
  if (!container || !registry) return;
  void adminAddr; // admin set is global; admin-gated by the view's visibility

  if (addBox) (addBox as HTMLElement).style.display = isOwner ? "" : "none";
  if (hint) hint.textContent = isOwner
    ? "Grant or revoke admin access. Admins can approve/reject schools and students; only the owner can manage admins."
    : "Read-only — only the contract owner can add or remove admins.";

  container.className = "empty-state";
  container.textContent = "Loading…";

  try {
    const ownerAddr = (await (registry as Contract).owner()) as string;
    const ownerLower = ownerAddr.toLowerCase();

    const addedLogs = await (registry as Contract).queryFilter(
      (registry as Contract).filters.AdminAdded(), 0, "latest");

    // Candidates from history (lowercase → checksummed display), minus the owner.
    const candidates = new Map<string, string>();
    for (const log of addedLogs as EventLog[]) {
      const a = log.args?.admin as string;
      candidates.set(a.toLowerCase(), a);
    }
    candidates.delete(ownerLower);

    // Confirm each candidate against current on-chain status (handles re-add/remove).
    const granted: string[] = [];
    await Promise.all([...candidates].map(async ([lower, original]) => {
      const ok = await (registry as Contract).isAdmin(lower).catch(() => false);
      if (ok) granted.push(original);
    }));

    const rows = [adminRow(ownerAddr, true, isOwner)];
    for (const a of granted.sort()) rows.push(adminRow(a, false, isOwner));

    container.className = "";
    container.innerHTML = rows.join("");
  } catch (e) {
    container.className = "empty-state";
    container.textContent = `Error: ${errMsg(e)}`;
  }
}

async function addAdminWallet(btn: HTMLButtonElement): Promise<void> {
  const input = document.getElementById("newAdminAddr") as HTMLInputElement | null;
  const raw = input?.value.trim() ?? "";
  if (!isAddress(raw)) {
    setResult("addAdminResult", "error", "❌ Enter a valid 0x… wallet address.");
    return;
  }
  setLoading(btn, true);
  try {
    await ensureConnected();
    const tx = await (registry as Contract).addAdmin(raw);
    setResult("addAdminResult", "pending", `⏳ Granting admin… ${txLink(tx.hash)}`);
    await tx.wait();
    setResult("addAdminResult", "success", `✅ Admin added. ${txLink(tx.hash)}`);
    if (input) input.value = "";
    renderManageAdmins(connectedAddr, true);
  } catch (e) {
    setResult("addAdminResult", "error", `❌ ${errMsg(e)}`);
  } finally {
    setLoading(btn, false);
  }
}

async function removeAdminWallet(addr: string, btn: HTMLButtonElement): Promise<void> {
  const resultId = `adminRowResult_${addr}`;
  if (!window.confirm(`Remove admin rights from ${addr}?`)) return;
  setLoading(btn, true);
  try {
    await ensureConnected();
    const tx = await (registry as Contract).removeAdmin(addr);
    setResult(resultId, "pending", `⏳ Removing… ${txLink(tx.hash)}`);
    await tx.wait();
    setResult(resultId, "success", "✓ Admin removed.");
    renderManageAdmins(connectedAddr, true);
  } catch (e) {
    setResult(resultId, "error", `❌ ${errMsg(e)}`);
  } finally {
    setLoading(btn, false);
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
window.studentDownload     = studentDownload;
window.studentGrantAccess  = studentGrantAccess;
window.studentRevokeAccess = studentRevokeAccess;
window.toggleGrantForm     = toggleGrantForm;
window.requestReissuance   = requestReissuance;
window.toggleLabelEdit     = toggleLabelEdit;
window.saveLocalLabel      = saveLocalLabel;
window.submitReissueRequest = submitReissueRequest;
window.closeReissueModal    = closeReissueModal;
window.approveReissue       = approveReissue;
window.rejectReissue        = rejectReissue;
window.toggleSignupRole     = toggleSignupRole;
window.reapply              = reapply;
window.approveSchoolApp     = approveSchoolApp;
window.rejectSchoolApp      = rejectSchoolApp;
window.approveStudentApp    = approveStudentApp;
window.rejectStudentApp     = rejectStudentApp;
window.addAdminWallet       = addAdminWallet;
window.removeAdminWallet    = removeAdminWallet;

// Populate signup school <select> + degree dropdowns/datalist on boot
// (DOM is ready — script tag at end of body).
populateSchoolSelect();
populateDegreeFields();

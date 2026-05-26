import {
  BrowserProvider,
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
  ETHERSCAN_TX,
  PINATA_GATEWAY,
  REGISTRY_ABI,
  CREDENTIAL_ABI,
} from "./config.js";
import { uploadToPinata } from "./utils/ipfs.js";

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
  }
}

// ─── State ────────────────────────────────────────────────────────────────────
let provider:   BrowserProvider | null = null;
let signer:     ContractRunner  | null = null;
let registry:   Contract        | null = null;
let credential: Contract        | null = null;

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

    const btn = document.getElementById("connectBtn") as HTMLButtonElement;
    btn.textContent = "Connected ✓";
    btn.disabled    = true;
    (document.getElementById("switchBtn") as HTMLElement).style.display = "inline-flex";

    window.ethereum.on("accountsChanged", () => location.reload());
    window.ethereum.on("chainChanged",    () => location.reload());
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

// ─── Live hash previews ───────────────────────────────────────────────────────
function updateCredHash(prefix: string): void {
  const studentAddr = getVal(`${prefix}StudentAddr`);
  const degreeType  = getVal(`${prefix}DegreeType`);
  const gradDate    = getVal(`${prefix}GradDate`);

  const preview = document.getElementById(`${prefix}HashPreview`);
  const value   = document.getElementById(`${prefix}HashValue`);
  if (!preview || !value) return;

  if (studentAddr && degreeType && gradDate) {
    try {
      value.textContent     = computeCredentialHash(studentAddr, degreeType, gradDate);
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
  const degreeType  = getVal(`${prefix}DegreeType`);
  const gradDate    = getVal(`${prefix}GradDate`);
  if (!studentAddr)            throw new Error("Enter student address.");
  if (!isAddress(studentAddr)) throw new Error(`Invalid student address: "${studentAddr}" — must be a valid 0x… Ethereum address.`);
  if (!degreeType)             throw new Error("Enter degree type.");
  if (!gradDate)               throw new Error("Enter graduation date.");
  return computeCredentialHash(studentAddr, degreeType, gradDate);
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
    const degreeType  = getVal("issueDegreeType");
    const gradDate    = getVal("issueGradDate");
    const pdfInput    = document.getElementById("issuePdf") as HTMLInputElement;
    const pdfFile     = pdfInput?.files?.[0] ?? null;

    if (!studentAddr)          throw new Error("Enter student address.");
    if (!isAddress(studentAddr)) throw new Error(`Invalid student address: "${studentAddr}" — must be a valid 0x… Ethereum address.`);
    if (!degreeType)           throw new Error("Enter degree type.");
    if (!gradDate)             throw new Error("Enter graduation date.");
    if (!pdfFile)              throw new Error("Select a diploma PDF file.");

    let cid: string;
    try {
      cid = await uploadToPinata(pdfFile);
    } catch (uploadErr) {
      throw new Error(`Upload failed: ${errMsg(uploadErr)}`);
    }

    const metadataURI = `ipfs://${cid}`;
    setResult("issueResult", "pending", `⛓ Submitting to Sepolia… CID: ${cid.slice(0, 12)}…`);

    const credHash = computeCredentialHash(studentAddr, degreeType, gradDate);
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

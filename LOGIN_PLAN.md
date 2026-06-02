# DACS Wallet-First Login & Role Routing

## Context

Current frontend renders all three role panels (Issuer / Holder / Verifier) side-by-side simultaneously. No login, no role gating, no persistence — any connected wallet sees everything; contract reverts enforce access at call time.

Goal: refactor into a wallet-first auto-router. Page load shows **Connect MetaMask**. After connect, run a wallet identity check (on-chain + localStorage) and route to one of four views:

```
[ Page 1: Connect MetaMask ]
              |
              v
     { Wallet ID Check }
              |
   +-----+-----+-----+-----+
   |     |     |     |
Issuer  Student Verifier Unknown
   |     |        |        |
   v     v        v        v
Issuer Student Verifier Create-Account
Dashboard Dashboard Dashboard (Student only)
```

User-confirmed constraints:
- **Detection** = on-chain queries + localStorage role tag.
- **One wallet = one role.** Multi-match → block with error; use a different wallet.
- **Self-signup** = Student only. Issuer is owner-gated by contract; Verifier emerges from on-chain grants.
- **Student dashboard** = lists degree(s); each card has "Request Re-issuance" → mailto.

Stack: vanilla TS + Vite + Ethers v6. Contract unchanged.

ABI additions (used across all phases):
- `REGISTRY_ABI` += `"function owner() external view returns (address)"`.
- `CREDENTIAL_ABI` += `"event VerifierAccessGranted(bytes32 indexed credentialHash, address indexed holder, address indexed verifier)"`.

This file = single source of truth. Update as you go. Mark each phase task `[x]` when shipped.

---

## Phase 1 — UI Shell & State Toggling

**Goal:** wire up the view-container scaffolding and the role-state machine. No Web3 calls yet. Buttons just flip views.

Tasks:
- [ ] **`frontend/index.html`** — replace the `.panels` 3-col grid with six `<section>` view containers:
  - `#viewConnect` (visible by default — Connect MetaMask button).
  - `#viewMultiRoleError` (hidden — multi-role banner + Disconnect button).
  - `#viewCreateAccount` (hidden — Student signup form).
  - `#viewIssuer` (hidden — existing Issuer markup moved in; wrap Register Issuer subsection in `#ownerOnlySection`).
  - `#viewStudent` (hidden — empty container, populated in Phase 3).
  - `#viewVerifier` (hidden — moved existing Verifier markup; search form added in Phase 3).
- [ ] **Header** — add `#currentRoleBadge` + `#logoutBtn` (both hidden until role set).
- [ ] **`frontend/src/main.ts`** — add:
  - `type UserRole = 'none'|'issuer'|'student'|'verifier'`.
  - `let userRole: UserRole = 'none'`.
  - `let connectedAddr: string = ''`.
  - `showView(viewId: string)` — toggles `display:block/none` across all six containers, updates `#currentRoleBadge` + `#logoutBtn` visibility.
  - `logout()` — clears `dacs:role:<addr>`, `connectedAddr = ''`, `userRole = 'none'`, `location.reload()`.
  - Stub `detectAndRoute(addr)` for now → just calls `showView('viewCreateAccount')` (no detection yet).
  - Wire `connectWallet()` to call `detectAndRoute(addr)` after successful connect.
  - `window.logout = logout` exposed.

Acceptance: page load shows only Connect button. Clicking it → MetaMask connect succeeds → routes to Create Account placeholder. Logout button reloads back to Connect.

---

## Phase 2 — Core Web3 Routing & Account Creation

**Goal:** real wallet identity check. Multi-role guard. Student account creation writes to localStorage.

Tasks:
- [ ] **`frontend/src/config.ts`** — add `owner()` to `REGISTRY_ABI` and `VerifierAccessGranted` event to `CREDENTIAL_ABI`.
- [ ] **`frontend/src/data/mockStudents.ts`** — new file:
  ```ts
  export interface MockStudent { name: string; walletAddress: string; school: string; }
  export interface MockIssuer  { name: string; walletAddress: string; email: string; }
  export const MOCK_SCHOOLS: string[] = ["MIT","ETHZ","Stanford","NUS"];
  export const MOCK_STUDENTS: MockStudent[] = [/* hand-edit with test wallets */];
  export const MOCK_ISSUERS:  MockIssuer[]  = [/* hand-edit with issuer wallets + emails */];
  ```
- [ ] **`detectAndRoute(addr)`** in `main.ts` — runs in parallel:
  ```ts
  const [isIssuer, ownerAddr, issuedLogs, grantedLogs] = await Promise.all([
    registry.isRegisteredIssuer(addr),
    registry.owner(),
    credential.queryFilter(credential.filters.CredentialIssued(null, null, addr)),
    credential.queryFilter(credential.filters.VerifierAccessGranted(null, null, addr)),
  ]);
  const isOwner   = ownerAddr.toLowerCase() === addr.toLowerCase();
  const profile   = localStorage.getItem(`dacs:profile:${addr.toLowerCase()}`);
  const roles = [
    (isOwner || isIssuer)         && 'issuer',
    (issuedLogs.length>0 || profile) && 'student',
    (grantedLogs.length>0)        && 'verifier',
  ].filter(Boolean);
  // 2+ → showView('viewMultiRoleError')
  // 1  → set userRole + showView('view'+Capitalized(role))
  // 0  → showView('viewCreateAccount')
  ```
  Toggle `#ownerOnlySection` based on `isOwner`.
- [ ] **`#viewCreateAccount`** form — name input + school `<select>` from `MOCK_SCHOOLS` + Submit button. `submitCreateAccount()` writes `localStorage.setItem('dacs:profile:'+addr.toLowerCase(), JSON.stringify({name, school}))`, then re-runs `detectAndRoute(addr)` (now matches student via localStorage).
- [ ] **`#viewMultiRoleError`** — static message + Disconnect button that calls `logout()`.
- [ ] **Header** — `#currentRoleBadge` shows `Role: {role} · {short addr}` once routed.
- [ ] `window.submitCreateAccount` exposed.

Acceptance:
- Owner wallet → Issuer view with Register Issuer subsection visible.
- Registered issuer wallet → Issuer view, Register Issuer hidden.
- Wallet with `CredentialIssued` logs as holder → Student view (Phase 3 will fill in cards; here just routes correctly + header shows role).
- Wallet on a verifier allowlist (has `VerifierAccessGranted` event) → Verifier view.
- Fresh wallet → Create Account → fill form → routes to Student.
- Wallet with two role signals → multi-role error.

---

## Phase 3 — Dashboard Rendering & Re-issuance

**Goal:** fill in Student dashboard (cred cards + reissuance mailto) and Verifier search dashboard. Existing Issuer panel needs no rework beyond Phase 1 relocation.

Tasks:
- [ ] **`renderStudentDashboard(addr)`** in `main.ts`:
  - `queryFilter(CredentialIssued, null, null, addr)` + `queryFilter(CredentialRevoked, ...)` for this holder's hashes.
  - Block-timestamp lookups via `provider.getBlock`.
  - For each cred, render a card with:
    - Degree + grad date — **Phase 3 fallback**: shows credHash truncated + "Degree details upgraded in next release" (real degree label arrives in Phase 4 via JSON sidecar).
    - Issued date.
    - Revoked badge if revoked.
    - IPFS Download button (reuses `getMetadataURI` + existing fetch flow — handles raw-PDF metadataURI for now).
    - Grant / Revoke Verifier Access inline form (verifier address input + button, reuses existing tx fns with autofilled credHash).
    - **Request Re-issuance** button.
- [ ] **`requestReissuance(credHash, issuerAddr)`** — looks up issuer email in `MOCK_ISSUERS`; builds:
  ```ts
  const to   = issuerEmail ?? '';
  const subj = encodeURIComponent(`Re-issuance request for credential ${credHash.slice(0,10)}…`);
  const body = encodeURIComponent(
    `Student wallet: ${connectedAddr}\nCredential hash: ${credHash}\nIssuer wallet: ${issuerAddr}\n\nPlease reissue.`
  );
  window.location.href = `mailto:${to}?subject=${subj}&body=${body}`;
  ```
- [ ] **`renderVerifierSearch()`** — populates `#viewVerifier`:
  - School `<select>` from `MOCK_SCHOOLS` + name input + Search button.
  - On submit: union of `MOCK_STUDENTS` and `localStorage` profiles (`dacs:profile:*`); filter by school + case-insensitive name substring.
  - Resolved wallet → list creds via `queryFilter(CredentialIssued, null, null, walletAddr)` → click cred → existing `doVerify` populates the existing verifier dashboard markup.
- [ ] `window.requestReissuance`, `window.verifierSearch`, `window.selectCredential` exposed.

Acceptance:
- Student dashboard loads cred cards for the connected holder. Revoked creds show badge. Download fetches PDF. Grant/Revoke Access work end-to-end.
- Request Re-issuance opens mail client with prefilled subject + body.
- Verifier search by school+name finds mock and localStorage students; clicking a cred runs verify; existing `verifyDashboard` renders Valid / Revoked / Not in allowlist correctly.

---

## Phase 4 — Pinata JSON Upgrade

**Goal:** store degreeType + gradDate in an IPFS JSON sidecar so Student / Verifier dashboards can display the real degree label. No contract change.

Tasks:
- [ ] **`frontend/src/utils/ipfs.ts`** — add `uploadJsonToPinata(obj: object): Promise<string>` (CID) calling Pinata `https://api.pinata.cloud/pinning/pinJSONToIPFS` with the same Pinata API key headers used today.
- [ ] **Issuer `doIssueCredential`** in `main.ts`:
  - Existing PDF upload returns `pdfCid`.
  - New: upload `{ degreeType, gradDate, pdfCid }` JSON → `jsonCid`.
  - `metadataURI = "ipfs://" + jsonCid`.
- [ ] **Generic `fetchCredentialMetadata(metadataURI)`** helper:
  - Fetches the URI from Pinata gateway.
  - Try `response.json()`; if success and object has `pdfCid` → return `{kind:'json', degreeType, gradDate, pdfCid}`.
  - Else treat as binary PDF (legacy format) → return `{kind:'pdf-legacy'}`.
- [ ] **Student dashboard cards** — call `fetchCredentialMetadata`:
  - JSON kind → show degree + date; Download button uses `pdfCid`.
  - Legacy kind → fall back to "Degree: Unknown (legacy credential)" + existing PDF download path.
- [ ] **Verifier dashboard** — extend `loadDashboardDetails` (`main.ts:485`) to also fetch JSON sidecar and show degreeType + gradDate above the existing detail rows.

Acceptance:
- Issue a fresh credential after Phase 4 lands → student dashboard shows degree label + grad date correctly.
- Old credentials issued before Phase 4 still load (legacy fallback path), with PDF download still working.
- Verifier dashboard shows degree label on new creds.

---

## File map

| File | Phase touched | Status |
|---|---|---|
| `frontend/index.html` | 1 (shell), 3 (verifier search form) | modify |
| `frontend/src/main.ts` | 1, 2, 3, 4 | modify |
| `frontend/src/config.ts` | 2 | modify (ABI adds) |
| `frontend/src/utils/ipfs.ts` | 4 | modify (add JSON upload) |
| `frontend/src/data/mockStudents.ts` | 2 | new |
| All Solidity + tests | — | unchanged |

---

## Reused existing utilities

- `computeCredentialHash()` — `main.ts:104`.
- `loadDashboardDetails()` — `main.ts:485` (extended in Phase 4 to fetch sidecar).
- `doVerify` — `main.ts:409` (wrapped by verifier search in Phase 3).
- `errMsg`, `setResult`, `setLoading`, `formatTs`, `txLink` — across all phases.

---

## End-to-end verification (after all 4 phases)

1. `cd frontend && npm run dev` → open `http://localhost:5173`. Only Connect button visible.
2. Connect with **owner wallet** → Issuer view, Register Issuer subsection visible.
3. Connect with **registered issuer wallet** → Issuer view, Register Issuer hidden. Issue a fresh credential (new student inputs) → tx confirmed; JSON sidecar pinned.
4. Connect with **fresh wallet** → Create Account → fill name+school → routed to Student view (empty list).
5. Issue a credential to that fresh wallet from step 3's issuer → switch MetaMask back to fresh wallet → reconnect → Student dashboard shows the new credential with degree + grad date (Phase 4 sidecar). Download works. Grant Access to a verifier wallet works.
6. Click Request Re-issuance → mail client opens with prefilled subject + body.
7. Connect with the verifier wallet → routed to Verifier search view (because of `VerifierAccessGranted` event). Search the student by school+name → cred list → click cred → dashboard shows Valid + degree label.
8. Connect with a wallet that matches multiple roles → multi-role error view.
9. Logout from any dashboard → back to Connect view; localStorage profile preserved (re-routes student on reconnect).
10. `npx hardhat test` → 78 passing (contracts unchanged).

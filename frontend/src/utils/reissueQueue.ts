// Local request queue for credential reissuance (Phase 6).
//
// The contract only lets a registered issuer call `issueCredential` /
// `revokeCredential`, so a student wallet cannot reissue its own credential
// directly. To remove the email round-trip in the existing flow, we shuttle
// requests through localStorage:
//
//   1. Student clicks "Request Re-issuance" on a card → writes a request
//      under `dacs:reissueReq:<id>` with status "pending".
//   2. Issuer reconnects later → the Issuer dashboard reads the pending queue,
//      filtered to requests addressed to that wallet, and shows Approve /
//      Reject buttons.
//   3. Approve fires revoke + re-issue from the issuer wallet → updates the
//      request status to "approved" and stores the new credential hash.
//
// Trade-offs:
//   - Same-browser only. Cross-device sync would need a backend.
//   - Visibility is gated by string-comparing the issuer wallet address.

export interface ReissueReqFields {
  level:     string;
  major:     string;
  dept:      string;
  studentId: string;
  gradDate:  string; // YYYY-MM-DD
}

export interface ReissueReq {
  id:           string;
  credHash:     string;
  holderAddr:   string;
  issuerAddr:   string;
  pdfCid:       string; // empty string for legacy (issuer must upload a fresh PDF on approval)
  requestedAt:  number;
  reason:       string;
  newFields:    ReissueReqFields;
  status:       "pending" | "approved" | "rejected";
  newCredHash?: string;
  newTxHash?:   string;
  rejectReason?: string;
}

const KEY_PREFIX = "dacs:reissueReq:";

function keyFor(id: string): string {
  return KEY_PREFIX + id;
}

function readKey(key: string): ReissueReq | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ReissueReq;
  } catch {
    return null;
  }
}

export function listAllReissueRequests(): ReissueReq[] {
  const out: ReissueReq[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(KEY_PREFIX)) continue;
    const req = readKey(k);
    if (req) out.push(req);
  }
  // Newest first.
  out.sort((a, b) => b.requestedAt - a.requestedAt);
  return out;
}

export function listPendingReissuesForIssuer(issuerAddr: string): ReissueReq[] {
  const lc = issuerAddr.toLowerCase();
  return listAllReissueRequests().filter(
    (r) => r.status === "pending" && r.issuerAddr.toLowerCase() === lc,
  );
}

// Returns the most recent request for a given credHash, regardless of status.
// Used by the student dashboard to render Pending / Approved / Rejected badges.
export function findReissueByCredHash(credHash: string): ReissueReq | null {
  const lc = credHash.toLowerCase();
  const all = listAllReissueRequests().filter(
    (r) => r.credHash.toLowerCase() === lc,
  );
  return all[0] ?? null; // listAll is sorted newest first
}

export function addReissueRequest(req: ReissueReq): void {
  localStorage.setItem(keyFor(req.id), JSON.stringify(req));
}

export function updateReissueRequest(id: string, patch: Partial<ReissueReq>): void {
  const existing = readKey(keyFor(id));
  if (!existing) return;
  const merged = { ...existing, ...patch };
  localStorage.setItem(keyFor(id), JSON.stringify(merged));
}

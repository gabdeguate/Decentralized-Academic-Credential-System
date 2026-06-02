/**
 * uploadToPinata — uploads a File to Pinata IPFS and returns the CID string.
 *
 * Uses VITE_PINATA_API_KEY + VITE_PINATA_SECRET_API_KEY from frontend/.env.
 * These are embedded in the browser bundle (visible in DevTools).
 * For production, route uploads through a backend proxy instead.
 *
 * @param file   PDF or other File object to pin.
 * @returns      IPFS CID string (e.g. "QmXyz..."). Caller prepends "ipfs://".
 * @throws       Readable error string on failure (upload vs auth vs network).
 */
// Build Pinata auth headers. Prefers a JWT (Bearer) — the modern, recommended
// auth — falling back to the legacy api-key/secret pair. Throws if neither set.
function pinataAuthHeaders(): Record<string, string> {
  const jwt = (import.meta.env.VITE_PINATA_JWT as string | undefined)?.trim();
  if (jwt) return { Authorization: `Bearer ${jwt}` };

  const apiKey    = import.meta.env.VITE_PINATA_API_KEY        as string | undefined;
  const secretKey = import.meta.env.VITE_PINATA_SECRET_API_KEY as string | undefined;
  if (apiKey && secretKey) {
    return { pinata_api_key: apiKey, pinata_secret_api_key: secretKey };
  }

  throw new Error(
    "Pinata auth not configured. Set VITE_PINATA_JWT (recommended) or " +
    "VITE_PINATA_API_KEY + VITE_PINATA_SECRET_API_KEY in frontend/.env"
  );
}

export async function uploadToPinata(file: File): Promise<string> {
  const authHeaders = pinataAuthHeaders();

  const formData = new FormData();
  formData.append("file", file);

  // Optional metadata shown in Pinata dashboard.
  formData.append(
    "pinataMetadata",
    JSON.stringify({ name: `diploma_${file.name}` })
  );

  let response: Response;
  try {
    response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: {
        // Note: do NOT set Content-Type — browser sets it with the boundary automatically.
        ...authHeaders,
      },
      body: formData,
    });
  } catch (networkErr) {
    throw new Error(`Network error contacting Pinata: ${(networkErr as Error).message}`);
  }

  if (!response.ok) {
    let detail = "";
    try { detail = await response.text(); } catch { /* ignore */ }
    if (response.status === 401) {
      throw new Error("Pinata upload failed (401): invalid API key or secret.");
    }
    throw new Error(
      `Pinata upload failed (${response.status})${detail ? ": " + detail.slice(0, 200) : ""}`
    );
  }

  const data = await response.json() as { IpfsHash: string };
  if (!data.IpfsHash) throw new Error("Pinata returned no CID in response.");
  return data.IpfsHash;
}

/**
 * uploadJsonToPinata — pins a JSON object to Pinata and returns its CID.
 *
 * Used for the credential metadata sidecar:
 *   { version: 1, level, major, dept, studentId, gradDate, degreeType, pdfCid }
 *
 * @param obj     Serializable object to pin.
 * @param name    Optional Pinata dashboard label.
 * @returns       IPFS CID string (caller prepends "ipfs://").
 */
export async function uploadJsonToPinata(obj: unknown, name = `dacs-meta-${Date.now()}`): Promise<string> {
  const authHeaders = pinataAuthHeaders();

  let response: Response;
  try {
    response = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({
        pinataContent:  obj,
        pinataMetadata: { name },
      }),
    });
  } catch (networkErr) {
    throw new Error(`Network error contacting Pinata: ${(networkErr as Error).message}`);
  }

  if (!response.ok) {
    let detail = "";
    try { detail = await response.text(); } catch { /* ignore */ }
    if (response.status === 401) {
      throw new Error("Pinata JSON upload failed (401): invalid API key or secret.");
    }
    throw new Error(
      `Pinata JSON upload failed (${response.status})${detail ? ": " + detail.slice(0, 200) : ""}`
    );
  }

  const data = await response.json() as { IpfsHash: string };
  if (!data.IpfsHash) throw new Error("Pinata returned no CID in JSON response.");
  return data.IpfsHash;
}

// ─── fetchPinName ─────────────────────────────────────────────────────────────
// Recover original Pinata pin filename for a CID. Used by the Student dashboard
// to enrich legacy credential titles (pre-Phase-4 creds whose metadataURI points
// at a raw PDF instead of a JSON sidecar). PDFs were originally pinned with
// metadata.name = `diploma_${file.name}` — we strip that prefix and the .pdf
// suffix to recover something usable.
//
// Returns null on any failure (network, 401, rate-limit, no rows, uninformative
// name). Never throws. Results memoized in a module-scoped cache so a dashboard
// re-render does not re-hit the API.

const pinNameCache = new Map<string, string | null>();

export async function fetchPinName(cid: string): Promise<string | null> {
  if (!cid) return null;
  if (pinNameCache.has(cid)) return pinNameCache.get(cid)!;

  let authHeaders: Record<string, string>;
  try {
    authHeaders = pinataAuthHeaders();
  } catch {
    pinNameCache.set(cid, null);
    return null;
  }

  try {
    const url = `https://api.pinata.cloud/data/pinList?hashContains=${encodeURIComponent(cid)}&status=pinned&pageLimit=1`;
    const resp = await fetch(url, {
      method: "GET",
      headers: { ...authHeaders },
    });
    if (!resp.ok) {
      pinNameCache.set(cid, null);
      return null;
    }
    const data = await resp.json() as { rows?: Array<{ metadata?: { name?: string } }> };
    const raw  = data.rows?.[0]?.metadata?.name;
    const normalized = normalizePinName(raw);
    pinNameCache.set(cid, normalized);
    return normalized;
  } catch {
    pinNameCache.set(cid, null);
    return null;
  }
}

function normalizePinName(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let s = raw.trim();
  // strip leading "diploma_" (case-insensitive)
  s = s.replace(/^diploma[_-]?/i, "");
  // strip trailing ".pdf"
  s = s.replace(/\.pdf$/i, "");
  s = s.trim();
  if (s.length < 3) return null;
  if (/^diploma$/i.test(s)) return null;
  return s;
}

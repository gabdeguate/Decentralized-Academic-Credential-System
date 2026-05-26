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
export async function uploadToPinata(file: File): Promise<string> {
  const apiKey    = import.meta.env.VITE_PINATA_API_KEY    as string | undefined;
  const secretKey = import.meta.env.VITE_PINATA_SECRET_API_KEY as string | undefined;

  if (!apiKey || !secretKey) {
    throw new Error(
      "Pinata keys not configured. Set VITE_PINATA_API_KEY and " +
      "VITE_PINATA_SECRET_API_KEY in frontend/.env"
    );
  }

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
        pinata_api_key:        apiKey,
        pinata_secret_api_key: secretKey,
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

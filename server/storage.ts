// Preconfigured storage helpers for Manus WebDev templates
// Uploads via Forge Server presigned URL to S3 (PUT direct).
// Downloads return /manus-storage/{key} paths served via 307 redirect.

import { ENV } from "./_core/env";

// Forge issues S3-compatible or CloudFront signed object URLs. Keep this
// narrow so a bad Forge response cannot make the server fetch or redirect to
// an arbitrary address.
const APPROVED_OBJECT_HOST_SUFFIXES = ["amazonaws.com", "cloudfront.net"];

export function isSafeStorageObjectUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && !url.port
      && APPROVED_OBJECT_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

function getForgeConfig() {
  const forgeUrl = ENV.forgeApiUrl;
  const forgeKey = ENV.forgeApiKey;

  if (!forgeUrl || !forgeKey) {
    throw new Error(
      "Storage config missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY",
    );
  }

  return { forgeUrl: forgeUrl.replace(/\/+$/, ""), forgeKey };
}

export function normalizeStorageKey(relKey: string): string {
  const key = relKey.replace(/^\/+/, "");
  if (!key || key.length > 1_024 || key.includes("\\") || key.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid storage key");
  }
  return key;
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
  options: { unique?: boolean } = {},
): Promise<{ key: string; url: string }> {
  const { forgeUrl, forgeKey } = getForgeConfig();
  const normalizedKey = normalizeStorageKey(relKey);
  // Most callers retain the historical collision-proof behavior. Private Deals
  // image processors opt in to stable keys only after fully deriving and
  // validating bytes server-side; this makes an overwrite idempotent and avoids
  // creating a fresh orphan on each retry when no delete API is available.
  const key = options.unique === false ? normalizedKey : appendHashSuffix(normalizedKey);

  // 1. Get presigned PUT URL from Forge
  const presignUrl = new URL("v1/storage/presign/put", forgeUrl + "/");
  presignUrl.searchParams.set("path", key);

  const presignResp = await fetch(presignUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });

  if (!presignResp.ok) {
    const msg = await presignResp.text().catch(() => presignResp.statusText);
    throw new Error(`Storage presign failed (${presignResp.status}): ${msg}`);
  }

  const { url: s3Url } = (await presignResp.json()) as { url: string };
  if (!s3Url || !isSafeStorageObjectUrl(s3Url)) throw new Error("Forge returned unsafe storage URL");

  // 2. PUT file directly to S3
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });

  const uploadResp = await fetch(s3Url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });

  if (!uploadResp.ok) {
    throw new Error(`Storage upload to S3 failed (${uploadResp.status})`);
  }

  return { key, url: `/manus-storage/${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeStorageKey(relKey);
  return { key, url: `/manus-storage/${key}` };
}

// Forge exposes only PUT and signed GET for this project. Builder Deals uses
// deterministic overwrite keys and prunes database render rows instead of
// pretending a destructive object API exists.
export const storageDeleteCapability = false;
export async function storageDelete(_relKey: string): Promise<false> { return false; }

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const { forgeUrl, forgeKey } = getForgeConfig();
  const key = normalizeStorageKey(relKey);

  const getUrl = new URL("v1/storage/presign/get", forgeUrl + "/");
  getUrl.searchParams.set("path", key);

  const resp = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Storage signed URL failed (${resp.status}): ${msg}`);
  }

  const { url } = (await resp.json()) as { url: string };
  if (!url || !isSafeStorageObjectUrl(url)) throw new Error("Forge returned unsafe storage URL");
  return url;
}

/**
 * Server-only reader for private Builder Deals assets. The signed object URL
 * remains inside the server process and the caller receives bytes, never it.
 */
export async function storageReadPrivate(relKey: string): Promise<{ data: Buffer; contentType: string }> {
  const key = normalizeStorageKey(relKey);
  if (!key.startsWith("builder-deals-private/")) {
    throw new Error("Private Deals storage key required");
  }
  const url = await storageGetSignedUrl(key);
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Private storage read failed (${response.status})`);
  return {
    data: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "image/webp",
  };
}

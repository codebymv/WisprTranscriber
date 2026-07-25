/**
 * Pure helpers for companion base URL config (local default, remote Railway, etc.).
 */

/** Local companion default — matches companion DEFAULT_PORT. */
export const DEFAULT_SERVICE_URL = "http://127.0.0.1:8788";

/**
 * Trim, strip trailing slashes, fall back to default when empty.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeServiceUrl(raw) {
  const trimmed = String(raw ?? "")
    .trim()
    .replace(/\/+$/, "");
  return trimmed || DEFAULT_SERVICE_URL;
}

/**
 * True when the value normalizes to an http(s) absolute URL.
 * @param {unknown} raw
 * @returns {boolean}
 */
export function isValidServiceUrl(raw) {
  try {
    const url = new URL(normalizeServiceUrl(raw));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Chrome host_permissions / permissions.request origin pattern for a service URL.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function serviceUrlOriginPattern(raw) {
  if (!isValidServiceUrl(raw)) return null;
  try {
    return `${new URL(normalizeServiceUrl(raw)).origin}/*`;
  } catch {
    return null;
  }
}

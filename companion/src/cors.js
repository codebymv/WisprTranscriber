/**
 * CORS helpers for browser-extension and local-dev callers.
 * Chrome extension pages send Origin: chrome-extension://<id>.
 */

/**
 * @param {string | null | undefined} origin
 * @returns {boolean}
 */
export function isAllowedCorsOrigin(origin) {
  if (!origin || typeof origin !== "string") return false;
  if (origin.startsWith("chrome-extension://")) {
    try {
      // Reject malformed / empty extension origins.
      const url = new URL(origin);
      return url.protocol === "chrome-extension:" && Boolean(url.hostname);
    } catch {
      return false;
    }
  }
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    return false;
  }
}

/**
 * Resolve Access-Control-Allow-Origin value.
 * - No Origin (curl / server clients): "*"
 * - Allowed browser Origin: reflect it (required for chrome-extension://)
 * - Unknown Origin: null (omit header → browser blocks)
 * @param {string | null | undefined} origin
 * @returns {string | null}
 */
export function resolveCorsAllowOrigin(origin) {
  if (!origin) return "*";
  if (isAllowedCorsOrigin(origin)) return origin;
  return null;
}

/**
 * @param {string | null | undefined} origin
 * @returns {Record<string, string>}
 */
export function corsHeaders(origin) {
  const allowOrigin = resolveCorsAllowOrigin(origin);
  /** @type {Record<string, string>} */
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (allowOrigin) {
    headers["Access-Control-Allow-Origin"] = allowOrigin;
  }
  return headers;
}

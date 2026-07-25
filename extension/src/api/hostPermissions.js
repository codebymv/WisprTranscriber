/**
 * Chrome optional host_permissions helpers for configurable companion URLs.
 * Injectable permissions API keeps the flow unit-testable offline.
 */

import { serviceUrlOriginPattern } from "./serviceUrl.js";

/**
 * @typedef {{
 *   contains: (details: { origins?: string[] }) => Promise<boolean>,
 *   request: (details: { origins?: string[] }) => Promise<boolean>,
 * }} PermissionsApi
 */

/**
 * Resolve chrome.permissions when present (MV3 extension context).
 * @returns {PermissionsApi | null}
 */
export function resolvePermissionsApi() {
  if (typeof chrome === "undefined" || !chrome.permissions?.request) return null;
  return chrome.permissions;
}

/**
 * Ensure the extension may fetch the companion origin.
 * - Invalid / unpatternable URL → false
 * - No permissions API (dev / Node tests) → true (treat as granted)
 * - Already contains origin → true (no prompt)
 * - User grants / denies request → that boolean
 * - API throw → false
 *
 * @param {unknown} serviceUrl
 * @param {PermissionsApi | null | undefined} [permissionsApi]
 * @returns {Promise<boolean>}
 */
export async function ensureHostPermission(serviceUrl, permissionsApi = resolvePermissionsApi()) {
  const originPattern = serviceUrlOriginPattern(serviceUrl);
  if (!originPattern) return false;
  if (!permissionsApi?.request || !permissionsApi?.contains) {
    // Dev / offline: no permissions API — treat as granted.
    return true;
  }
  try {
    const already = await permissionsApi.contains({ origins: [originPattern] });
    if (already) return true;
    return await permissionsApi.request({ origins: [originPattern] });
  } catch {
    return false;
  }
}

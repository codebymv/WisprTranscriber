/**
 * Pure helpers for companion HTTP JSON bodies.
 * Keeps gateway HTML / non-JSON errors as status-based messages so
 * upload/job recovery classifiers can match 502/503/504.
 */

/**
 * Parse a companion response body.
 * @param {number} status
 * @param {boolean} ok
 * @param {string} [text]
 * @returns {unknown}
 */
export function parseCompanionResponse(status, ok, text = "") {
  const body = typeof text === "string" ? text : "";
  /** @type {unknown} */
  let payload = {};

  if (body.trim()) {
    try {
      payload = JSON.parse(body);
    } catch {
      if (!ok) {
        throw new Error(`Request failed with ${status}`);
      }
      throw new Error(`Invalid companion response (${status}).`);
    }
  }

  if (!ok) {
    const error =
      payload &&
      typeof payload === "object" &&
      typeof /** @type {{ error?: unknown }} */ (payload).error === "string"
        ? /** @type {{ error: string }} */ (payload).error.trim()
        : "";
    throw new Error(error || `Request failed with ${status}`);
  }

  return payload;
}

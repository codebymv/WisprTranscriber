/**
 * Pure helpers for recovering when createJob (upload) fails mid-request.
 */

/**
 * @typedef {"unreachable" | "rejected"} UploadFailureKind
 */

/**
 * Classify a createJob / upload failure.
 * Network / companion-down errors are "unreachable"; validation / HTTP rejects stay "rejected".
 *
 * @param {unknown} error
 * @returns {UploadFailureKind}
 */
export function resolveUploadFailure(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!message.trim()) return "unreachable";

  if (
    /failed to fetch/i.test(message) ||
    /networkerror/i.test(message) ||
    /load failed/i.test(message) ||
    /connection refused/i.test(message) ||
    /econnrefused/i.test(message) ||
    /network request failed/i.test(message) ||
    /\b502\b/.test(message) ||
    /\b503\b/.test(message) ||
    /\b504\b/.test(message)
  ) {
    return "unreachable";
  }

  return "rejected";
}

/**
 * User-facing copy after an upload failure.
 * Unreachable keeps files selected and points at Retry / companion recovery.
 *
 * @param {UploadFailureKind} kind
 * @param {string} [fallbackMessage]
 * @returns {string}
 */
export function describeUploadFailure(kind, fallbackMessage = "") {
  if (kind === "unreachable") {
    return "Upload interrupted — Wispr Cloud unreachable. Your files are still selected; retry when companion is back.";
  }
  const trimmed = typeof fallbackMessage === "string" ? fallbackMessage.trim() : "";
  return trimmed || "Could not start transcription.";
}

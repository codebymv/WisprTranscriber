/**
 * Pure helpers for recovering when getJob fails while opening a recent/session job.
 */

/**
 * Classify a getJob failure for local-list / session cleanup.
 * Only true 404/not-found should drop local state — network errors must keep it.
 *
 * @param {unknown} error
 * @returns {"clear-local" | "keep-local"}
 */
export function resolveJobLoadRecovery(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/not found/i.test(message) || /\b404\b/.test(message)) {
    return "clear-local";
  }
  return "keep-local";
}

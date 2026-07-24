/**
 * Pure helpers for recovering popup state when Cancel (DELETE) fails.
 */

/**
 * @typedef {{ status: string }} JobStatusLike
 * @typedef {{ kind: "alive", job: JobStatusLike }
 *   | { kind: "missing" }
 *   | { kind: "unreachable" }} CancelFailureProbe
 * @typedef {"reattach" | "sync-terminal" | "clear-local" | "keep-busy"} FailedCancelRecovery
 */

/**
 * After DELETE /jobs/:id fails, classify a follow-up getJob probe.
 *
 * @param {CancelFailureProbe} probe
 * @returns {FailedCancelRecovery}
 */
export function resolveFailedCancelRecovery(probe) {
  if (probe.kind === "unreachable") return "keep-busy";
  if (probe.kind === "missing") return "clear-local";

  const status = probe.job?.status;
  if (status === "queued" || status === "running") return "reattach";
  return "sync-terminal";
}

/**
 * Build a CancelFailureProbe from a getJob attempt.
 *
 * @param {() => Promise<JobStatusLike>} fetchJob
 * @returns {Promise<CancelFailureProbe>}
 */
export async function probeJobAfterFailedCancel(fetchJob) {
  try {
    const job = await fetchJob();
    if (!job) return { kind: "missing" };
    return { kind: "alive", job };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? "");
    if (/not found/i.test(message) || /\b404\b/.test(message)) {
      return { kind: "missing" };
    }
    return { kind: "unreachable" };
  }
}

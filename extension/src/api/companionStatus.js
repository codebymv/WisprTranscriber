/**
 * Pure helpers for companion health + job event transport labels in the popup.
 */

/**
 * @typedef {{ ok: boolean, hasApiKey: boolean, ffmpegFound: boolean, model?: string }} HealthLike
 * @typedef {"checking" | "ready" | "degraded" | "unreachable"} CompanionHealthState
 * @typedef {"sse" | "poll"} JobEventTransport
 */

/**
 * @param {HealthLike | null} health
 * @param {string | null} [reachError]
 * @returns {{ state: CompanionHealthState, title: string, detail: string | null, reasons: string[] }}
 */
export function describeCompanionHealth(health, reachError = null) {
  if (reachError) {
    return {
      state: "unreachable",
      title: "Wispr Cloud unreachable",
      detail: reachError,
      reasons: [reachError],
    };
  }

  if (!health) {
    return {
      state: "checking",
      title: "Checking Wispr Cloud",
      detail: "Checking Wispr Cloud…",
      reasons: [],
    };
  }

  /** @type {string[]} */
  const reasons = [];
  if (!health.hasApiKey) reasons.push("API key missing");
  if (!health.ffmpegFound) reasons.push("ffmpeg missing");

  if (health.ok && reasons.length === 0) {
    const model = health.model ? ` · ${health.model}` : "";
    return {
      state: "ready",
      title: `Wispr Cloud ready${model}`,
      detail: null,
      reasons: [],
    };
  }

  const detail = reasons.length > 0 ? reasons.join(" · ") : "Wispr Cloud needs attention";
  return {
    state: "degraded",
    title: "Wispr Cloud needs attention",
    detail,
    reasons,
  };
}

/**
 * Dot styling collapses degraded + unreachable into "error".
 * @param {CompanionHealthState} state
 * @returns {"checking" | "ready" | "error"}
 */
export function healthDotState(state) {
  if (state === "checking") return "checking";
  if (state === "ready") return "ready";
  return "error";
}

/**
 * @param {JobEventTransport | null | undefined} transport
 * @param {{ watching?: boolean }} [options]
 * @returns {string | null}
 */
export function describeJobTransport(transport, options = {}) {
  if (!options.watching) return null;
  if (!transport) return "Connecting…";
  if (transport === "sse") return "Live updates";
  if (transport === "poll") return "Polling · reconnecting live updates";
  return null;
}

/** Default: treat 60s+ as a "long" outage for Retry-success copy. */
export const LONG_OUTAGE_MS = 60_000;

/**
 * Compact outage duration for toast copy (e.g. "45s", "3m", "2h").
 * @param {number} elapsedMs
 * @returns {string | null}
 */
export function formatOutageDuration(elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return null;
  const seconds = Math.round(elapsedMs / 1000);
  if (seconds < 60) return `${Math.max(1, seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

/**
 * Tiny confirm after Retry recovers from unreachable.
 * Long outages get a duration hint; brief blips stay one short line.
 *
 * @param {{
 *   wasUnreachable: boolean,
 *   recovered: boolean,
 *   unreachableSinceMs?: number | null,
 *   nowMs?: number,
 *   longOutageMs?: number,
 * }} input
 * @returns {{ message: string } | null}
 */
export function resolveRetrySuccessToast(input) {
  if (!input.wasUnreachable || !input.recovered) return null;

  const since = input.unreachableSinceMs;
  const now = input.nowMs ?? Date.now();
  const longOutageMs = input.longOutageMs ?? LONG_OUTAGE_MS;

  if (since != null && Number.isFinite(since)) {
    const elapsed = now - since;
    if (elapsed >= longOutageMs) {
      const duration = formatOutageDuration(elapsed);
      if (duration) {
        return { message: `Wispr Cloud is back · was offline ${duration}` };
      }
    }
  }

  return { message: "Wispr Cloud is back" };
}

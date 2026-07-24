import assert from "node:assert/strict";
import test from "node:test";
import {
  describeCompanionHealth,
  describeJobTransport,
  formatOutageDuration,
  healthDotState,
  LONG_OUTAGE_MS,
  resolveRetrySuccessToast,
} from "../src/api/companionStatus.js";

test("describeCompanionHealth checking before first result", () => {
  const view = describeCompanionHealth(null);
  assert.equal(view.state, "checking");
  assert.equal(view.detail, "Checking Wispr Cloud…");
  assert.equal(healthDotState(view.state), "checking");
});

test("describeCompanionHealth ready when ok", () => {
  const view = describeCompanionHealth({
    ok: true,
    hasApiKey: true,
    ffmpegFound: true,
    model: "whisper-1",
  });
  assert.equal(view.state, "ready");
  assert.equal(view.detail, null);
  assert.match(view.title, /ready/);
  assert.match(view.title, /whisper-1/);
  assert.equal(healthDotState(view.state), "ready");
});

test("describeCompanionHealth lists ffmpeg and API key failures", () => {
  const view = describeCompanionHealth({
    ok: false,
    hasApiKey: false,
    ffmpegFound: false,
    model: "whisper-1",
  });
  assert.equal(view.state, "degraded");
  assert.equal(view.detail, "API key missing · ffmpeg missing");
  assert.deepEqual(view.reasons, ["API key missing", "ffmpeg missing"]);
  assert.equal(healthDotState(view.state), "error");
});

test("describeCompanionHealth prefers reach errors over stale payload", () => {
  const view = describeCompanionHealth(
    { ok: true, hasApiKey: true, ffmpegFound: true, model: "x" },
    "Could not reach Wispr Cloud.",
  );
  assert.equal(view.state, "unreachable");
  assert.equal(view.detail, "Could not reach Wispr Cloud.");
  assert.equal(healthDotState(view.state), "error");
});

test("describeJobTransport only while watching", () => {
  assert.equal(describeJobTransport("sse"), null);
  assert.equal(describeJobTransport("sse", { watching: false }), null);
  assert.equal(describeJobTransport("sse", { watching: true }), "Live updates");
  assert.equal(
    describeJobTransport("poll", { watching: true }),
    "Polling · reconnecting live updates",
  );
  assert.equal(describeJobTransport(null, { watching: true }), "Connecting…");
  assert.equal(describeJobTransport(undefined, { watching: true }), "Connecting…");
  assert.equal(describeJobTransport(null, { watching: false }), null);
});

test("formatOutageDuration compact units", () => {
  assert.equal(formatOutageDuration(1_200), "1s");
  assert.equal(formatOutageDuration(45_000), "45s");
  assert.equal(formatOutageDuration(3 * 60_000), "3m");
  assert.equal(formatOutageDuration(2 * 60 * 60_000), "2h");
  assert.equal(formatOutageDuration(-1), null);
});

test("resolveRetrySuccessToast only after unreachable recovery", () => {
  assert.equal(
    resolveRetrySuccessToast({ wasUnreachable: false, recovered: true }),
    null,
  );
  assert.equal(
    resolveRetrySuccessToast({ wasUnreachable: true, recovered: false }),
    null,
  );
  assert.deepEqual(
    resolveRetrySuccessToast({ wasUnreachable: true, recovered: true }),
    { message: "Wispr Cloud is back" },
  );
});

test("resolveRetrySuccessToast adds duration after long outage", () => {
  const nowMs = 1_000_000;
  const short = resolveRetrySuccessToast({
    wasUnreachable: true,
    recovered: true,
    unreachableSinceMs: nowMs - 15_000,
    nowMs,
    longOutageMs: LONG_OUTAGE_MS,
  });
  assert.deepEqual(short, { message: "Wispr Cloud is back" });

  const long = resolveRetrySuccessToast({
    wasUnreachable: true,
    recovered: true,
    unreachableSinceMs: nowMs - 5 * 60_000,
    nowMs,
    longOutageMs: LONG_OUTAGE_MS,
  });
  assert.deepEqual(long, { message: "Wispr Cloud is back · was offline 5m" });
});

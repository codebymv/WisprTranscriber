import assert from "node:assert/strict";
import test from "node:test";
import {
  probeJobAfterFailedCancel,
  resolveFailedCancelRecovery,
} from "../src/api/cancelRecovery.js";

test("resolveFailedCancelRecovery reattaches when job still active", () => {
  assert.equal(
    resolveFailedCancelRecovery({ kind: "alive", job: { status: "queued" } }),
    "reattach",
  );
  assert.equal(
    resolveFailedCancelRecovery({ kind: "alive", job: { status: "running" } }),
    "reattach",
  );
});

test("resolveFailedCancelRecovery syncs terminal jobs", () => {
  assert.equal(
    resolveFailedCancelRecovery({ kind: "alive", job: { status: "done" } }),
    "sync-terminal",
  );
  assert.equal(
    resolveFailedCancelRecovery({ kind: "alive", job: { status: "error" } }),
    "sync-terminal",
  );
  assert.equal(
    resolveFailedCancelRecovery({ kind: "alive", job: { status: "cancelled" } }),
    "sync-terminal",
  );
});

test("resolveFailedCancelRecovery clears when job is gone", () => {
  assert.equal(resolveFailedCancelRecovery({ kind: "missing" }), "clear-local");
});

test("resolveFailedCancelRecovery keeps busy when companion unreachable", () => {
  assert.equal(resolveFailedCancelRecovery({ kind: "unreachable" }), "keep-busy");
});

test("probeJobAfterFailedCancel classifies alive / missing / unreachable", async () => {
  const alive = await probeJobAfterFailedCancel(async () => ({ status: "running" }));
  assert.deepEqual(alive, { kind: "alive", job: { status: "running" } });

  const missingNull = await probeJobAfterFailedCancel(async () => null);
  assert.deepEqual(missingNull, { kind: "missing" });

  const missing404 = await probeJobAfterFailedCancel(async () => {
    throw new Error("Job not found.");
  });
  assert.deepEqual(missing404, { kind: "missing" });

  const unreachable = await probeJobAfterFailedCancel(async () => {
    throw new Error("Failed to fetch");
  });
  assert.deepEqual(unreachable, { kind: "unreachable" });
});

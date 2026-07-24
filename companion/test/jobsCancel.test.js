import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  JobCancelledError,
  cancelAndCleanupJob,
  cancelJob,
  clearJobsForTests,
  createJob,
  getJob,
  getJobSignal,
  setJobsDataDir,
  throwIfCancelled,
  updateJob,
} from "../src/jobs.js";
import { runProcess } from "../src/process.js";

test("cancelJob aborts signal and marks cancelled", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wispr-cancel-"));
  setJobsDataDir(dataDir);

  const job = createJob("cancel-me");
  updateJob(job, { status: "running", stage: "Compressing" });
  assert.equal(getJobSignal(job).aborted, false);

  const cancelled = cancelJob(job.jobId);
  assert.ok(cancelled);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.stage, "Cancelled");
  assert.equal(cancelled.error, "Cancelled by user.");
  assert.equal(getJobSignal(job).aborted, true);
  assert.throws(() => throwIfCancelled(job), JobCancelledError);

  const sidecar = path.join(dataDir, "jobs", job.jobId, "job.json");
  assert.equal(fs.existsSync(sidecar), true);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("cancelAndCleanupJob deletes job directory and stops persist", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wispr-cleanup-"));
  setJobsDataDir(dataDir);

  const job = createJob("cleanup-me");
  updateJob(job, { status: "running", stage: "Transcribing" });
  const jobPath = path.join(dataDir, "jobs", job.jobId);
  assert.equal(fs.existsSync(jobPath), true);

  const cleaned = cancelAndCleanupJob(job.jobId);
  assert.ok(cleaned);
  assert.equal(cleaned.status, "cancelled");
  assert.equal(cleaned.cleanedUp, true);
  assert.equal(fs.existsSync(jobPath), false);
  assert.equal(getJob(job.jobId), null);

  // Stale worker updates must not recreate the deleted directory.
  updateJob(cleaned, { stage: "Should not persist" });
  assert.equal(fs.existsSync(jobPath), false);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("hydrate marks orphaned running jobs interrupted after restart", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wispr-orphan-"));
  setJobsDataDir(dataDir);

  const job = createJob("orphan-me");
  updateJob(job, { status: "running", stage: "Compressing", progress: 20 });
  clearJobsForTests();

  const hydrated = getJob(job.jobId);
  assert.ok(hydrated);
  assert.equal(hydrated.status, "cancelled");
  assert.equal(hydrated.stage, "Interrupted");
  assert.match(hydrated.error ?? "", /companion restart/);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("runProcess rejects with JobCancelledError when signal aborts", async () => {
  const controller = new AbortController();
  const command = process.platform === "win32" ? "ping" : "sleep";
  const args = process.platform === "win32" ? ["127.0.0.1", "-n", "20"] : ["20"];

  const pending = runProcess(command, args, controller.signal);
  await delay(80);
  controller.abort();

  await assert.rejects(pending, JobCancelledError);
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

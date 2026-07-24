import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  addArtifact,
  clearJobsForTests,
  createJob,
  getJob,
  setJobsDataDir,
  updateJob,
} from "../src/jobs.js";

test("persists job.json and hydrates after map miss", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wispr-jobs-"));
  setJobsDataDir(dataDir);

  const job = createJob("meeting-notes");
  updateJob(job, { status: "done", stage: "Done", progress: 100 });
  addArtifact(job, {
    kind: "transcript",
    label: "meeting-notes-full-transcript.txt",
    path: path.join(dataDir, "jobs", job.jobId, "meeting-notes-full-transcript.txt"),
    contentType: "text/plain; charset=utf-8",
  });

  const sidecar = path.join(dataDir, "jobs", job.jobId, "job.json");
  assert.equal(fs.existsSync(sidecar), true);

  clearJobsForTests();
  const hydrated = getJob(job.jobId);
  assert.ok(hydrated);
  assert.equal(hydrated.jobName, "meeting-notes");
  assert.equal(hydrated.status, "done");
  assert.equal(hydrated.artifacts.length, 1);
  assert.equal(hydrated.artifacts[0].label, "meeting-notes-full-transcript.txt");
  assert.ok(hydrated.artifacts[0].path);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

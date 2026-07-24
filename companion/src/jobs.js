import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const jobs = new Map();
let dataDir = null;

export class JobCancelledError extends Error {
  constructor(message = "Job cancelled.") {
    super(message);
    this.name = "JobCancelledError";
  }
}

export function setJobsDataDir(nextDataDir) {
  dataDir = nextDataDir;
}

export function createJob(jobName) {
  const job = attachRuntime({
    jobId: crypto.randomUUID(),
    jobName,
    status: "queued",
    stage: "Queued",
    progress: 0,
    files: [],
    artifacts: [],
    error: null,
    logs: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  jobs.set(job.jobId, job);
  persistJob(job);
  return job;
}

export function getJob(jobId) {
  return jobs.get(jobId) ?? hydrateJob(jobId);
}

/** Test helper: simulate companion restart by dropping in-memory jobs. */
export function clearJobsForTests() {
  jobs.clear();
}

export function serializeJob(job) {
  return {
    jobId: job.jobId,
    jobName: job.jobName,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    files: job.files,
    artifacts: job.artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      label: artifact.label,
      contentType: artifact.contentType,
    })),
    error: job.error,
    logs: job.logs,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export function updateJob(job, patch) {
  if (job.cleanedUp) return;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  persistJob(job);
  emitJob(job);
}

export function addLog(job, message) {
  if (job.cleanedUp) return;
  job.logs.push(`[${new Date().toLocaleTimeString()}] ${message}`);
  if (job.logs.length > 200) job.logs = job.logs.slice(-200);
  job.updatedAt = new Date().toISOString();
  persistJob(job);
  emitJob(job);
}

export function addArtifact(job, artifact) {
  if (job.cleanedUp) return;
  job.artifacts.push({
    id: crypto.randomUUID(),
    ...artifact,
  });
  job.updatedAt = new Date().toISOString();
  persistJob(job);
  emitJob(job);
}

export function subscribeJob(job, send) {
  job.listeners.add(send);
  send(serializeJob(job));
  return () => job.listeners.delete(send);
}

export function getJobSignal(job) {
  return job.cancelController.signal;
}

export function isActiveJob(job) {
  return job.status === "queued" || job.status === "running";
}

export function throwIfCancelled(job) {
  if (job.cleanedUp || job.status === "cancelled" || job.cancelController.signal.aborted) {
    throw new JobCancelledError();
  }
}

/**
 * Abort in-flight work and mark the job cancelled.
 * Keeps files on disk until cleanupJob / cancelAndCleanupJob.
 */
export function cancelJob(jobId) {
  const job = getJob(jobId);
  if (!job) return null;

  if (isActiveJob(job)) {
    job.cancelController.abort();
    updateJob(job, {
      status: "cancelled",
      stage: "Cancelled",
      error: "Cancelled by user.",
    });
    addLog(job, "Job cancelled.");
  }

  return job;
}

/**
 * Remove job from memory and delete its data directory.
 * Cancels first when the job is still active so workers stop touching files.
 */
export function cancelAndCleanupJob(jobId) {
  const job = getJob(jobId);
  if (!job) return null;

  if (isActiveJob(job)) {
    cancelJob(jobId);
  }

  job.cleanedUp = true;
  job.listeners.clear();
  jobs.delete(jobId);

  if (dataDir) {
    fs.rmSync(jobDir(jobId), { recursive: true, force: true });
  }

  return job;
}

function emitJob(job) {
  if (job.cleanedUp) return;
  const payload = serializeJob(job);
  for (const send of job.listeners) send(payload);
}

function jobDir(jobId) {
  return path.join(dataDir, "jobs", jobId);
}

function persistJob(job) {
  if (!dataDir || job.cleanedUp) return;
  const dir = jobDir(job.jobId);
  fs.mkdirSync(dir, { recursive: true });
  const payload = {
    jobId: job.jobId,
    jobName: job.jobName,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    files: job.files,
    artifacts: job.artifacts,
    error: job.error,
    logs: job.logs,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
  fs.writeFileSync(path.join(dir, "job.json"), JSON.stringify(payload, null, 2));
}

function hydrateJob(jobId) {
  if (!dataDir) return null;
  const filePath = path.join(jobDir(jobId), "job.json");
  if (!fs.existsSync(filePath)) return null;

  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!data || data.jobId !== jobId) return null;
    const job = attachRuntime({
      jobId: data.jobId,
      jobName: data.jobName ?? "wispr-job",
      status: data.status ?? "done",
      stage: data.stage ?? "Done",
      progress: data.progress ?? 100,
      files: Array.isArray(data.files) ? data.files : [],
      artifacts: Array.isArray(data.artifacts) ? data.artifacts : [],
      error: data.error ?? null,
      logs: Array.isArray(data.logs) ? data.logs : [],
      createdAt: data.createdAt ?? new Date().toISOString(),
      updatedAt: data.updatedAt ?? new Date().toISOString(),
    });

    // Companion restart cannot resume ffmpeg/OpenAI work; mark orphans terminal.
    if (isActiveJob(job)) {
      job.status = "cancelled";
      job.stage = "Interrupted";
      job.error = "Interrupted by companion restart.";
      job.updatedAt = new Date().toISOString();
      if (!job.logs.some((line) => line.includes("Interrupted by companion restart"))) {
        job.logs.push(`[${new Date().toLocaleTimeString()}] Interrupted by companion restart.`);
      }
      persistJob(job);
    }

    jobs.set(jobId, job);
    return job;
  } catch {
    return null;
  }
}

function attachRuntime(job) {
  job.listeners = new Set();
  job.cancelController = new AbortController();
  job.cleanedUp = false;
  return job;
}

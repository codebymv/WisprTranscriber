import crypto from "node:crypto";

const jobs = new Map();

export function createJob(jobName) {
  const job = {
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
    listeners: new Set(),
  };
  jobs.set(job.jobId, job);
  return job;
}

export function getJob(jobId) {
  return jobs.get(jobId) ?? null;
}

export function serializeJob(job) {
  return {
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
}

export function updateJob(job, patch) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  emitJob(job);
}

export function addLog(job, message) {
  job.logs.push(`[${new Date().toLocaleTimeString()}] ${message}`);
  if (job.logs.length > 200) job.logs = job.logs.slice(-200);
  job.updatedAt = new Date().toISOString();
  emitJob(job);
}

export function addArtifact(job, artifact) {
  job.artifacts.push({
    id: crypto.randomUUID(),
    ...artifact,
  });
  job.updatedAt = new Date().toISOString();
  emitJob(job);
}

export function subscribeJob(job, send) {
  job.listeners.add(send);
  send(serializeJob(job));
  return () => job.listeners.delete(send);
}

function emitJob(job) {
  const payload = serializeJob(job);
  for (const send of job.listeners) send(payload);
}

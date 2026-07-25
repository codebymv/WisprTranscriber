import { parseCompanionResponse } from "./companionResponse.js";
import { normalizeServiceUrl } from "./serviceUrl.js";
import { HealthPayload, JobPayload } from "./types";

export async function getHealth(serviceUrl: string): Promise<HealthPayload> {
  const response = await fetch(`${normalizeServiceUrl(serviceUrl)}/health`);
  return parseJson(response);
}

export async function createJob(
  serviceUrl: string,
  files: File[],
  jobName: string,
): Promise<{ jobId: string }> {
  const form = new FormData();
  if (jobName.trim()) form.append("jobName", jobName.trim());
  for (const file of files) form.append("files", file, file.name);

  const response = await fetch(`${normalizeServiceUrl(serviceUrl)}/jobs`, {
    method: "POST",
    body: form,
  });
  return parseJson(response);
}

export async function getJob(serviceUrl: string, jobId: string): Promise<JobPayload> {
  const response = await fetch(`${normalizeServiceUrl(serviceUrl)}/jobs/${jobId}`);
  return parseJson(response);
}

/** Cancel in-flight work (if any) and delete the job directory on the companion. */
export async function cancelAndCleanupJob(
  serviceUrl: string,
  jobId: string,
): Promise<{ ok: boolean; jobId: string; cancelled: boolean; cleanedUp: boolean }> {
  const response = await fetch(`${normalizeServiceUrl(serviceUrl)}/jobs/${jobId}`, {
    method: "DELETE",
  });
  return parseJson(response);
}

export function artifactUrl(serviceUrl: string, jobId: string, artifactId: string): string {
  return `${normalizeServiceUrl(serviceUrl)}/jobs/${jobId}/artifacts/${artifactId}`;
}

export function eventsUrl(serviceUrl: string, jobId: string): string {
  return `${normalizeServiceUrl(serviceUrl)}/jobs/${jobId}/events`;
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  return parseCompanionResponse(response.status, response.ok, text) as T;
}

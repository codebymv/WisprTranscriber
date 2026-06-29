import { HealthPayload, JobPayload } from "./types";

export async function getHealth(serviceUrl: string): Promise<HealthPayload> {
  const response = await fetch(`${trimUrl(serviceUrl)}/health`);
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

  const response = await fetch(`${trimUrl(serviceUrl)}/jobs`, {
    method: "POST",
    body: form,
  });
  return parseJson(response);
}

export async function getJob(serviceUrl: string, jobId: string): Promise<JobPayload> {
  const response = await fetch(`${trimUrl(serviceUrl)}/jobs/${jobId}`);
  return parseJson(response);
}

export function artifactUrl(serviceUrl: string, jobId: string, artifactId: string): string {
  return `${trimUrl(serviceUrl)}/jobs/${jobId}/artifacts/${artifactId}`;
}

export function eventsUrl(serviceUrl: string, jobId: string): string {
  return `${trimUrl(serviceUrl)}/jobs/${jobId}/events`;
}

function trimUrl(serviceUrl: string): string {
  return serviceUrl.replace(/\/+$/, "");
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with ${response.status}`);
  }
  return payload as T;
}

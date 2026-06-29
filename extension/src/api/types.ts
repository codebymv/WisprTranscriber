export type HealthPayload = {
  ok: boolean;
  version: string;
  hasApiKey: boolean;
  ffmpegFound: boolean;
  ffmpegPath: string;
  model: string;
};

export type JobArtifact = {
  id: string;
  kind: "audio" | "transcript";
  label: string;
  contentType: string;
};

export type JobPayload = {
  jobId: string;
  jobName: string;
  status: "queued" | "running" | "done" | "error";
  stage: string;
  progress: number;
  files: Array<{ name: string; size: number }>;
  artifacts: JobArtifact[];
  error: string | null;
  logs: string[];
  createdAt: string;
  updatedAt: string;
};

export type Settings = {
  serviceUrl: string;
};

export const DEFAULT_SETTINGS: Settings = {
  serviceUrl: "https://wisprtranscriber.up.railway.app",
};

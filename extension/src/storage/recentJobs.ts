export type RecentJob = {
  jobId: string;
  jobName: string;
  updatedAt: string;
  status?: "queued" | "running" | "done" | "error" | "cancelled";
};

const STORAGE_KEY = "wisprRecentJobs";
export const RECENT_JOBS_LIMIT = 10;

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

export async function loadRecentJobs(): Promise<RecentJob[]> {
  if (!hasChromeStorage()) return [];
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const list = stored?.[STORAGE_KEY];
  return Array.isArray(list) ? (list as RecentJob[]) : [];
}

export async function upsertRecentJob(entry: RecentJob): Promise<RecentJob[]> {
  const current = await loadRecentJobs();
  const next = [
    entry,
    ...current.filter((job) => job.jobId !== entry.jobId),
  ].slice(0, RECENT_JOBS_LIMIT);

  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
  }
  return next;
}

export async function removeRecentJob(jobId: string): Promise<RecentJob[]> {
  const next = (await loadRecentJobs()).filter((job) => job.jobId !== jobId);
  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
  }
  return next;
}

export type JobSession = {
  jobId: string;
  fileSignature: string;
  jobName: string;
};

const STORAGE_KEY = "wisprActiveJob";

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

export async function loadJobSession(): Promise<JobSession | null> {
  if (!hasChromeStorage()) return null;
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return (stored?.[STORAGE_KEY] ?? null) as JobSession | null;
}

export async function saveJobSession(session: JobSession): Promise<void> {
  if (!hasChromeStorage()) return;
  await chrome.storage.local.set({ [STORAGE_KEY]: session });
}

export async function clearJobSession(): Promise<void> {
  if (!hasChromeStorage()) return;
  await chrome.storage.local.remove(STORAGE_KEY);
}
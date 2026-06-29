import { DEFAULT_SETTINGS, Settings } from "../api/types";

const STORAGE_KEY = "wisprSettings";
let memoryFallback: Settings | null = null;

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

export async function loadSettings(): Promise<Settings> {
  if (!hasChromeStorage()) return { ...DEFAULT_SETTINGS, ...(memoryFallback ?? {}) };
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return { ...DEFAULT_SETTINGS, ...((stored?.[STORAGE_KEY] ?? {}) as Partial<Settings>) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  const normalized: Settings = {
    serviceUrl: (settings.serviceUrl.trim() || DEFAULT_SETTINGS.serviceUrl).replace(/\/+$/, ""),
  };
  if (!hasChromeStorage()) {
    memoryFallback = normalized;
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
}

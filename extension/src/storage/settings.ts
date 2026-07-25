import { ensureHostPermission } from "../api/hostPermissions.js";
import { DEFAULT_SETTINGS, Settings } from "../api/types";
import { isValidServiceUrl, normalizeServiceUrl } from "../api/serviceUrl.js";

const STORAGE_KEY = "wisprSettings";
let memoryFallback: Settings | null = null;

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

export async function loadSettings(): Promise<Settings> {
  if (!hasChromeStorage()) {
    return { ...DEFAULT_SETTINGS, ...(memoryFallback ?? {}) };
  }
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const partial = (stored?.[STORAGE_KEY] ?? {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...partial,
    serviceUrl: normalizeServiceUrl(partial.serviceUrl ?? DEFAULT_SETTINGS.serviceUrl),
  };
}

/**
 * Persist companion base URL. Requests optional host permission when needed.
 * @returns normalized settings, or throws on invalid URL / denied permission
 */
export async function saveSettings(settings: Settings): Promise<Settings> {
  if (!isValidServiceUrl(settings.serviceUrl)) {
    throw new Error("Companion URL must be a valid http(s) address.");
  }
  const normalized: Settings = {
    serviceUrl: normalizeServiceUrl(settings.serviceUrl),
  };

  const granted = await ensureHostPermission(normalized.serviceUrl);
  if (!granted) {
    throw new Error("Chrome blocked host access for that companion URL.");
  }

  if (!hasChromeStorage()) {
    memoryFallback = normalized;
    return normalized;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
  return normalized;
}

import { isSupportedAudioFile } from "./config.js";

/**
 * Validate multipart upload entries before creating a job, so rejected
 * requests never leave orphaned queued jobs on disk.
 *
 * @param {Iterable<unknown>} files
 * @returns {Promise<{ ok: true, uploads: Array<{ originalName: string, bytes: Buffer }> } | { ok: false, error: string }>}
 */
export async function validateUploadFiles(files) {
  const list = Array.isArray(files) ? files : [...files];
  const uploads = [];

  for (const file of list) {
    if (!file || typeof file.arrayBuffer !== "function") continue;

    const originalName =
      typeof file.name === "string" && file.name.trim() ? file.name : "audio";

    if (!isSupportedAudioFile(originalName)) {
      return { ok: false, error: `Unsupported audio extension: ${originalName}` };
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length === 0) {
      return { ok: false, error: `${originalName} is empty.` };
    }

    uploads.push({ originalName, bytes });
  }

  if (uploads.length === 0) {
    return { ok: false, error: "No valid audio files were uploaded." };
  }

  return { ok: true, uploads };
}

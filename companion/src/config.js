import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  SUPPORTED_AUDIO_EXTENSIONS,
  isSupportedAudioFileName,
} from "../../shared/supportedAudio.js";

export const VERSION = "0.1.0";
export const DEFAULT_PORT = 8788;
export const DEFAULT_MODEL = "whisper-1";
export const DEFAULT_FFMPEG_PATH = process.platform === "win32" ? "C:\\ffmpeg\\bin\\ffmpeg.exe" : "ffmpeg";
export const DEFAULT_DATA_DIR = path.resolve("data");
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const TARGET_CHUNK_BYTES = 22 * 1024 * 1024;
export const CHUNK_SECONDS = 45 * 60;
/** Matches companion compressAudio bitrate (20 kbps mono). */
export const COMPRESS_BITRATE_BYTES_PER_SEC = 20_000 / 8;
export const MIN_CHUNK_SECONDS = 60;
export const SUPPORTED_EXTENSIONS = new Set(SUPPORTED_AUDIO_EXTENSIONS);

/**
 * Choose ffmpeg segment length so chunks stay near TARGET_CHUNK_BYTES
 * while never exceeding CHUNK_SECONDS.
 * Returns null when no split is required.
 */
export function computeChunkSegmentSeconds(compressedSize, durationSeconds) {
  const sizeOk = compressedSize <= TARGET_CHUNK_BYTES;
  const durationOk = !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds <= CHUNK_SECONDS;
  if (sizeOk && durationOk) return null;

  let segmentSeconds = CHUNK_SECONDS;

  if (compressedSize > TARGET_CHUNK_BYTES) {
    if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
      const parts = Math.max(2, Math.ceil(compressedSize / TARGET_CHUNK_BYTES));
      segmentSeconds = Math.floor(durationSeconds / parts);
    } else {
      segmentSeconds = Math.floor(TARGET_CHUNK_BYTES / COMPRESS_BITRATE_BYTES_PER_SEC);
    }
  }

  return Math.min(CHUNK_SECONDS, Math.max(MIN_CHUNK_SECONDS, segmentSeconds));
}

export function loadDotEnv(filePath = path.resolve(".env")) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals === -1) continue;
    const key = trimmed.slice(0, equals).trim();
    const value = trimmed.slice(equals + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

export function getConfig() {
  return {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_TRANSCRIBE_MODEL || DEFAULT_MODEL,
    ffmpegPath: process.env.FFMPEG_PATH || DEFAULT_FFMPEG_PATH,
    dataDir: process.env.WISPR_DATA_DIR || DEFAULT_DATA_DIR,
    port: Number(process.env.WISPR_PORT || process.env.PORT || DEFAULT_PORT),
    host:
      process.env.WISPR_HOST ||
      (process.env.RAILWAY_PUBLIC_DOMAIN || process.env.PORT ? "0.0.0.0" : "127.0.0.1"),
    mockTranscription: process.env.WISPR_MOCK_TRANSCRIPTION === "1",
  };
}

export function ffprobePathFor(ffmpegPath) {
  const parsed = path.parse(ffmpegPath);
  const ffprobeName = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
  return path.join(parsed.dir, ffprobeName);
}

export function isSupportedAudioFile(fileName) {
  return isSupportedAudioFileName(fileName);
}

export function executableExists(command) {
  if (path.isAbsolute(command) || command.includes(path.sep)) {
    return fs.existsSync(command);
  }
  const result = spawnSync(command, ["-version"], {
    stdio: "ignore",
    windowsHide: true,
  });
  return result.status === 0;
}

export function safeBaseName(fileName) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  return base.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "audio";
}
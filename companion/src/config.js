import fs from "node:fs";
import path from "node:path";

export const VERSION = "0.1.0";
export const DEFAULT_PORT = 8788;
export const DEFAULT_MODEL = "whisper-1";
export const DEFAULT_FFMPEG_PATH = "C:\\ffmpeg\\bin\\ffmpeg.exe";
export const DEFAULT_DATA_DIR = path.resolve("data");
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const TARGET_CHUNK_BYTES = 22 * 1024 * 1024;
export const CHUNK_SECONDS = 45 * 60;
export const SUPPORTED_EXTENSIONS = new Set([
  ".mp3",
  ".mp4",
  ".mpeg",
  ".mpga",
  ".m4a",
  ".wav",
  ".webm",
]);

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
    port: Number(process.env.WISPR_PORT || DEFAULT_PORT),
    mockTranscription: process.env.WISPR_MOCK_TRANSCRIPTION === "1",
  };
}

export function ffprobePathFor(ffmpegPath) {
  const parsed = path.parse(ffmpegPath);
  const ffprobeName = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
  return path.join(parsed.dir, ffprobeName);
}

export function isSupportedAudioFile(fileName) {
  return SUPPORTED_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

export function safeBaseName(fileName) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  return base.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "audio";
}

/**
 * OpenAI Whisper-compatible audio extensions.
 * Single source of truth for companion + extension validation/UI.
 */
export const SUPPORTED_AUDIO_EXTENSIONS = Object.freeze([
  ".mp3",
  ".mp4",
  ".mpeg",
  ".mpga",
  ".m4a",
  ".wav",
  ".webm",
]);

const SUPPORTED_SET = new Set(SUPPORTED_AUDIO_EXTENSIONS);

export function audioFileExtension(fileName) {
  const name = String(fileName ?? "");
  const dot = name.lastIndexOf(".");
  if (dot === -1) return "";
  return name.slice(dot).toLowerCase();
}

export function isSupportedAudioFileName(fileName) {
  return SUPPORTED_SET.has(audioFileExtension(fileName));
}

/** HTML file-input accept value (extensions + audio/*). */
export function supportedAudioAcceptAttribute() {
  return `${SUPPORTED_AUDIO_EXTENSIONS.join(",")},audio/*`;
}

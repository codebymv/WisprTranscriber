import {
  isSupportedAudioFileName,
  supportedAudioAcceptAttribute,
} from "../../../shared/supportedAudio.js";

export { isSupportedAudioFileName, supportedAudioAcceptAttribute };

/** Returns a user-facing error, or null when all files are usable. */
export function validateSelectedAudioFiles(files: File[]): string | null {
  if (files.length === 0) {
    return "Choose at least one audio file first.";
  }

  for (const file of files) {
    if (!isSupportedAudioFileName(file.name)) {
      return `Unsupported audio extension: ${file.name}`;
    }
    if (file.size === 0) {
      return `${file.name} is empty.`;
    }
  }

  return null;
}

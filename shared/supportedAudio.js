/**
 * Re-export companion module so the extension keeps importing from shared/.
 * Implementation lives in companion/src (required for Railway deploy root).
 */
export {
  SUPPORTED_AUDIO_EXTENSIONS,
  audioFileExtension,
  isSupportedAudioFileName,
  supportedAudioAcceptAttribute,
} from "../companion/src/supportedAudio.js";

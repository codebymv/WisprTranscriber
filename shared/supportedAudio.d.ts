export const SUPPORTED_AUDIO_EXTENSIONS: readonly string[];

export function audioFileExtension(fileName: string): string;

export function isSupportedAudioFileName(fileName: string): boolean;

export function supportedAudioAcceptAttribute(): string;

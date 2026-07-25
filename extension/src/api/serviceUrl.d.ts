export const DEFAULT_SERVICE_URL: string;

export function normalizeServiceUrl(raw: unknown): string;

export function isValidServiceUrl(raw: unknown): boolean;

export function serviceUrlOriginPattern(raw: unknown): string | null;

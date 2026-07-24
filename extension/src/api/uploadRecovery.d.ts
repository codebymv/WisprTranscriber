export type UploadFailureKind = "unreachable" | "rejected";

export function resolveUploadFailure(error: unknown): UploadFailureKind;

export function describeUploadFailure(
  kind: UploadFailureKind,
  fallbackMessage?: string,
): string;

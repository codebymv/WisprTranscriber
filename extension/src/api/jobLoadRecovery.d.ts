export type JobLoadRecovery = "clear-local" | "keep-local";

export function resolveJobLoadRecovery(error: unknown): JobLoadRecovery;

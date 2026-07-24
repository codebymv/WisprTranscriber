export type CancelFailureProbe<T extends { status: string } = { status: string }> =
  | { kind: "alive"; job: T }
  | { kind: "missing" }
  | { kind: "unreachable" };

export type FailedCancelRecovery = "reattach" | "sync-terminal" | "clear-local" | "keep-busy";

export function resolveFailedCancelRecovery(
  probe: CancelFailureProbe,
): FailedCancelRecovery;

export function probeJobAfterFailedCancel<T extends { status: string }>(
  fetchJob: () => Promise<T | null | undefined>,
): Promise<CancelFailureProbe<T>>;

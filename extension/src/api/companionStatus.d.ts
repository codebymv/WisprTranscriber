import type { HealthPayload } from "./types";
import type { JobEventTransport } from "./jobEvents";

export type CompanionHealthState = "checking" | "ready" | "degraded" | "unreachable";

export type CompanionHealthView = {
  state: CompanionHealthState;
  title: string;
  detail: string | null;
  reasons: string[];
};

export function describeCompanionHealth(
  health: Pick<HealthPayload, "ok" | "hasApiKey" | "ffmpegFound" | "model"> | null,
  reachError?: string | null,
): CompanionHealthView;

export function healthDotState(state: CompanionHealthState): "checking" | "ready" | "error";

export function describeJobTransport(
  transport: JobEventTransport | null | undefined,
  options?: { watching?: boolean },
): string | null;

export const LONG_OUTAGE_MS: number;

export function formatOutageDuration(elapsedMs: number): string | null;

export function resolveRetrySuccessToast(input: {
  wasUnreachable: boolean;
  recovered: boolean;
  unreachableSinceMs?: number | null;
  nowMs?: number;
  longOutageMs?: number;
}): { message: string } | null;

export function nextSseReconnectDelayMs(
  attempt: number,
  options?: { baseMs?: number; maxMs?: number },
): number;

export type JobEventTransport = "sse" | "poll";

export type JobEventWatcher = {
  stop: () => void;
  /** Aborts when stop() runs — use to ignore in-flight poll/update work after cancel. */
  signal: AbortSignal;
};

export type CreateJobEventWatcherOptions = {
  url: string;
  onMessage: (data: string) => void;
  onPoll: () => void | Promise<void>;
  pollIntervalMs?: number;
  baseReconnectMs?: number;
  maxReconnectMs?: number;
  onTransportChange?: (transport: JobEventTransport) => void;
  EventSourceImpl?: typeof EventSource;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
};

export function createJobEventWatcher(options: CreateJobEventWatcherOptions): JobEventWatcher;

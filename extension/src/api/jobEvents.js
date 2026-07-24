/**
 * Exponential backoff delay for SSE reconnect attempts.
 * attempt 0 => baseMs, then doubles until maxMs.
 * @param {number} attempt
 * @param {{ baseMs?: number, maxMs?: number }} [options]
 * @returns {number}
 */
export function nextSseReconnectDelayMs(attempt, options = {}) {
  const baseMs = options.baseMs ?? 1000;
  const maxMs = options.maxMs ?? 30_000;
  const n = Math.max(0, Math.floor(attempt));
  return Math.min(maxMs, baseMs * 2 ** n);
}

/**
 * Watch a job over SSE with reconnect/backoff. Polling runs only while SSE is down.
 *
 * @param {object} options
 * @param {string} options.url
 * @param {(data: string) => void} options.onMessage
 * @param {() => void | Promise<void>} options.onPoll
 * @param {number} [options.pollIntervalMs]
 * @param {number} [options.baseReconnectMs]
 * @param {number} [options.maxReconnectMs]
 * @param {(transport: "sse" | "poll") => void} [options.onTransportChange]
 * @param {typeof EventSource} [options.EventSourceImpl]
 * @param {typeof setTimeout} [options.setTimeoutFn]
 * @param {typeof clearTimeout} [options.clearTimeoutFn]
 * @param {typeof setInterval} [options.setIntervalFn]
 * @param {typeof clearInterval} [options.clearIntervalFn]
 * @returns {{ stop: () => void, signal: AbortSignal }}
 */
export function createJobEventWatcher(options) {
  const url = options.url;
  const onMessage = options.onMessage;
  const onPoll = options.onPoll;
  const pollIntervalMs = options.pollIntervalMs ?? 3000;
  const baseReconnectMs = options.baseReconnectMs ?? 1000;
  const maxReconnectMs = options.maxReconnectMs ?? 30_000;
  const onTransportChange = options.onTransportChange;
  const EventSourceImpl = options.EventSourceImpl ?? globalThis.EventSource;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;

  if (typeof EventSourceImpl !== "function") {
    throw new Error("EventSource is not available.");
  }

  const abortController = new AbortController();
  let closed = false;
  /** @type {EventSource | null} */
  let source = null;
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let pollTimer;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let reconnectTimer;
  let attempt = 0;

  function stopPolling() {
    if (pollTimer === undefined) return;
    clearIntervalFn(pollTimer);
    pollTimer = undefined;
  }

  function startPolling() {
    if (closed || pollTimer !== undefined) return;
    onTransportChange?.("poll");
    pollTimer = setIntervalFn(() => {
      if (closed) return;
      void onPoll();
    }, pollIntervalMs);
  }

  function clearReconnect() {
    if (reconnectTimer === undefined) return;
    clearTimeoutFn(reconnectTimer);
    reconnectTimer = undefined;
  }

  function detachSource() {
    if (!source) return;
    source.onopen = null;
    source.onmessage = null;
    source.onerror = null;
    source.close();
    source = null;
  }

  function scheduleReconnect() {
    if (closed || reconnectTimer !== undefined) return;
    const delay = nextSseReconnectDelayMs(attempt, {
      baseMs: baseReconnectMs,
      maxMs: maxReconnectMs,
    });
    attempt += 1;
    reconnectTimer = setTimeoutFn(() => {
      reconnectTimer = undefined;
      if (closed) return;
      connect();
    }, delay);
  }

  function connect() {
    if (closed) return;
    detachSource();

    const es = new EventSourceImpl(url);
    source = es;

    es.onopen = () => {
      if (closed || source !== es) return;
      attempt = 0;
      stopPolling();
      onTransportChange?.("sse");
    };

    es.onmessage = (event) => {
      if (closed || source !== es) return;
      onMessage(event.data);
    };

    es.onerror = () => {
      if (closed || source !== es) return;
      detachSource();
      startPolling();
      scheduleReconnect();
    };
  }

  function stop() {
    if (closed) return;
    closed = true;
    abortController.abort();
    clearReconnect();
    stopPolling();
    detachSource();
  }

  connect();
  return { stop, signal: abortController.signal };
}

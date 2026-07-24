import assert from "node:assert/strict";
import test from "node:test";
import {
  createJobEventWatcher,
  nextSseReconnectDelayMs,
} from "../src/api/jobEvents.js";

test("nextSseReconnectDelayMs doubles until max", () => {
  assert.equal(nextSseReconnectDelayMs(0, { baseMs: 1000, maxMs: 30_000 }), 1000);
  assert.equal(nextSseReconnectDelayMs(1, { baseMs: 1000, maxMs: 30_000 }), 2000);
  assert.equal(nextSseReconnectDelayMs(2, { baseMs: 1000, maxMs: 30_000 }), 4000);
  assert.equal(nextSseReconnectDelayMs(10, { baseMs: 1000, maxMs: 30_000 }), 30_000);
});

test("createJobEventWatcher polls only while SSE is disconnected, then reconnects", async () => {
  /** @type {FakeEventSource[]} */
  const sources = [];
  /** @type {Array<"sse" | "poll">} */
  const transports = [];
  /** @type {string[]} */
  const messages = [];
  let pollCount = 0;

  /** @type {Map<number, Function>} */
  const timeouts = new Map();
  /** @type {Map<number, Function>} */
  const intervals = new Map();
  let nextTimerId = 1;

  class FakeEventSource {
    /**
     * @param {string} url
     */
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.closed = false;
      sources.push(this);
    }

    close() {
      this.closed = true;
      this.readyState = 2;
    }

    open() {
      this.readyState = 1;
      this.onopen?.();
    }

    /**
     * @param {string} data
     */
    push(data) {
      this.onmessage?.({ data });
    }

    fail() {
      this.readyState = 2;
      this.onerror?.();
    }
  }

  /**
   * @param {Function} fn
   * @param {number} _ms
   */
  const setTimeoutFn = (fn, _ms) => {
    const id = nextTimerId++;
    timeouts.set(id, () => {
      timeouts.delete(id);
      fn();
    });
    return id;
  };
  /**
   * @param {number | undefined} id
   */
  const clearTimeoutFn = (id) => {
    timeouts.delete(/** @type {number} */ (id));
  };
  /**
   * @param {Function} fn
   * @param {number} _ms
   */
  const setIntervalFn = (fn, _ms) => {
    const id = nextTimerId++;
    intervals.set(id, fn);
    return id;
  };
  /**
   * @param {number | undefined} id
   */
  const clearIntervalFn = (id) => {
    intervals.delete(/** @type {number} */ (id));
  };

  const watcher = createJobEventWatcher({
    url: "http://local.test/jobs/1/events",
    onMessage: (data) => messages.push(data),
    onPoll: () => {
      pollCount += 1;
    },
    pollIntervalMs: 50,
    baseReconnectMs: 10,
    maxReconnectMs: 10,
    onTransportChange: (transport) => transports.push(transport),
    EventSourceImpl: /** @type {typeof EventSource} */ (/** @type {unknown} */ (FakeEventSource)),
    setTimeoutFn: /** @type {typeof setTimeout} */ (setTimeoutFn),
    clearTimeoutFn: /** @type {typeof clearTimeout} */ (clearTimeoutFn),
    setIntervalFn: /** @type {typeof setInterval} */ (setIntervalFn),
    clearIntervalFn: /** @type {typeof clearInterval} */ (clearIntervalFn),
  });

  assert.equal(sources.length, 1);
  assert.equal(intervals.size, 0);
  assert.equal(pollCount, 0);

  sources[0].open();
  assert.deepEqual(transports, ["sse"]);
  sources[0].push('{"status":"running"}');
  assert.deepEqual(messages, ['{"status":"running"}']);
  assert.equal(intervals.size, 0);

  sources[0].fail();
  assert.ok(sources[0].closed);
  assert.deepEqual(transports, ["sse", "poll"]);
  assert.equal(intervals.size, 1);
  assert.equal(timeouts.size, 1);

  // Poll tick while disconnected.
  for (const tick of intervals.values()) tick();
  assert.equal(pollCount, 1);

  // Backoff timer fires -> new EventSource.
  for (const due of [...timeouts.values()]) due();
  assert.equal(sources.length, 2);
  assert.equal(timeouts.size, 0);

  sources[1].open();
  assert.deepEqual(transports, ["sse", "poll", "sse"]);
  assert.equal(intervals.size, 0);

  // Polling must stay off while SSE is healthy again.
  assert.equal(pollCount, 1);

  watcher.stop();
  assert.ok(sources[1].closed);
  assert.equal(timeouts.size, 0);
  assert.equal(intervals.size, 0);
});

test("createJobEventWatcher stop prevents further reconnect/poll", () => {
  /** @type {FakeEventSource[]} */
  const sources = [];
  /** @type {Map<number, Function>} */
  const timeouts = new Map();
  let nextTimerId = 1;

  class FakeEventSource {
    constructor() {
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.closed = false;
      sources.push(this);
    }
    close() {
      this.closed = true;
    }
    fail() {
      this.onerror?.();
    }
  }

  const watcher = createJobEventWatcher({
    url: "http://local.test/jobs/1/events",
    onMessage: () => {},
    onPoll: () => {},
    baseReconnectMs: 5,
    maxReconnectMs: 5,
    EventSourceImpl: /** @type {typeof EventSource} */ (/** @type {unknown} */ (FakeEventSource)),
    setTimeoutFn: /** @type {typeof setTimeout} */ ((fn) => {
      const id = nextTimerId++;
      timeouts.set(id, fn);
      return id;
    }),
    clearTimeoutFn: /** @type {typeof clearTimeout} */ ((id) => {
      timeouts.delete(/** @type {number} */ (id));
    }),
    setIntervalFn: /** @type {typeof setInterval} */ (() => 99),
    clearIntervalFn: /** @type {typeof clearInterval} */ (() => {}),
  });

  sources[0].fail();
  assert.equal(timeouts.size, 1);
  assert.equal(watcher.signal.aborted, false);

  watcher.stop();
  assert.equal(timeouts.size, 0);
  assert.equal(watcher.signal.aborted, true);

  // Stale scheduled work must not open another source after stop.
  assert.equal(sources.length, 1);
});

test("createJobEventWatcher stop mid-reconnect ignores late open/message/poll", () => {
  /** @type {FakeEventSource[]} */
  const sources = [];
  /** @type {Array<"sse" | "poll">} */
  const transports = [];
  /** @type {string[]} */
  const messages = [];
  let pollCount = 0;

  /** @type {Map<number, Function>} */
  const timeouts = new Map();
  /** @type {Map<number, Function>} */
  const intervals = new Map();
  let nextTimerId = 1;

  class FakeEventSource {
    /**
     * @param {string} url
     */
    constructor(url) {
      this.url = url;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.closed = false;
      sources.push(this);
    }

    close() {
      this.closed = true;
    }

    open() {
      this.onopen?.();
    }

    /**
     * @param {string} data
     */
    push(data) {
      this.onmessage?.({ data });
    }

    fail() {
      this.onerror?.();
    }
  }

  /**
   * @param {Function} fn
   * @param {number} _ms
   */
  const setTimeoutFn = (fn, _ms) => {
    const id = nextTimerId++;
    timeouts.set(id, () => {
      timeouts.delete(id);
      fn();
    });
    return id;
  };
  /**
   * @param {number | undefined} id
   */
  const clearTimeoutFn = (id) => {
    timeouts.delete(/** @type {number} */ (id));
  };
  /**
   * @param {Function} fn
   * @param {number} _ms
   */
  const setIntervalFn = (fn, _ms) => {
    const id = nextTimerId++;
    intervals.set(id, fn);
    return id;
  };
  /**
   * @param {number | undefined} id
   */
  const clearIntervalFn = (id) => {
    intervals.delete(/** @type {number} */ (id));
  };

  const watcher = createJobEventWatcher({
    url: "http://local.test/jobs/1/events",
    onMessage: (data) => messages.push(data),
    onPoll: () => {
      pollCount += 1;
    },
    pollIntervalMs: 50,
    baseReconnectMs: 10,
    maxReconnectMs: 10,
    onTransportChange: (transport) => transports.push(transport),
    EventSourceImpl: /** @type {typeof EventSource} */ (/** @type {unknown} */ (FakeEventSource)),
    setTimeoutFn: /** @type {typeof setTimeout} */ (setTimeoutFn),
    clearTimeoutFn: /** @type {typeof clearTimeout} */ (clearTimeoutFn),
    setIntervalFn: /** @type {typeof setInterval} */ (setIntervalFn),
    clearIntervalFn: /** @type {typeof clearInterval} */ (clearIntervalFn),
  });

  sources[0].open();
  sources[0].fail();
  assert.deepEqual(transports, ["sse", "poll"]);
  assert.equal(intervals.size, 1);
  assert.equal(timeouts.size, 1);

  // Reconnect timer fires -> second EventSource is connecting (not open yet).
  for (const due of [...timeouts.values()]) due();
  assert.equal(sources.length, 2);
  assert.equal(sources[1].closed, false);

  // Cancel while reconnecting: abort signal + clear poll/reconnect timers.
  watcher.stop();
  assert.equal(watcher.signal.aborted, true);
  assert.ok(sources[1].closed);
  assert.equal(timeouts.size, 0);
  assert.equal(intervals.size, 0);

  // Late events from the in-flight reconnect must be ignored.
  sources[1].open();
  sources[1].push('{"status":"running"}');
  sources[1].fail();
  assert.deepEqual(messages, []);
  assert.deepEqual(transports, ["sse", "poll"]);
  assert.equal(pollCount, 0);
  assert.equal(sources.length, 2);
  assert.equal(timeouts.size, 0);
  assert.equal(intervals.size, 0);
});

test("createJobEventWatcher stop mid-backoff clears poll without late ticks", () => {
  /** @type {FakeEventSource[]} */
  const sources = [];
  let pollCount = 0;

  /** @type {Map<number, Function>} */
  const timeouts = new Map();
  /** @type {Map<number, Function>} */
  const intervals = new Map();
  let nextTimerId = 1;

  class FakeEventSource {
    constructor() {
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.closed = false;
      sources.push(this);
    }
    close() {
      this.closed = true;
    }
    fail() {
      this.onerror?.();
    }
  }

  const watcher = createJobEventWatcher({
    url: "http://local.test/jobs/1/events",
    onMessage: () => {},
    onPoll: () => {
      pollCount += 1;
    },
    baseReconnectMs: 100,
    maxReconnectMs: 100,
    EventSourceImpl: /** @type {typeof EventSource} */ (/** @type {unknown} */ (FakeEventSource)),
    setTimeoutFn: /** @type {typeof setTimeout} */ ((fn) => {
      const id = nextTimerId++;
      timeouts.set(id, fn);
      return id;
    }),
    clearTimeoutFn: /** @type {typeof clearTimeout} */ ((id) => {
      timeouts.delete(/** @type {number} */ (id));
    }),
    setIntervalFn: /** @type {typeof setInterval} */ ((fn) => {
      const id = nextTimerId++;
      intervals.set(id, fn);
      return id;
    }),
    clearIntervalFn: /** @type {typeof clearInterval} */ ((id) => {
      intervals.delete(/** @type {number} */ (id));
    }),
  });

  sources[0].fail();
  assert.equal(intervals.size, 1);
  assert.equal(timeouts.size, 1);

  const stalePollTicks = [...intervals.values()];
  const staleReconnect = [...timeouts.values()];

  watcher.stop();
  assert.equal(watcher.signal.aborted, true);
  assert.equal(intervals.size, 0);
  assert.equal(timeouts.size, 0);

  // Even if a cleared timer callback were retained and invoked, closed guards must no-op.
  for (const tick of stalePollTicks) tick();
  for (const due of staleReconnect) due();
  assert.equal(pollCount, 0);
  assert.equal(sources.length, 1);
});

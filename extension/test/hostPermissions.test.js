import assert from "node:assert/strict";
import test from "node:test";
import { ensureHostPermission, resolvePermissionsApi } from "../src/api/hostPermissions.js";

test("resolvePermissionsApi is null outside Chrome", () => {
  assert.equal(resolvePermissionsApi(), null);
});

test("ensureHostPermission rejects unpatternable URLs", async () => {
  assert.equal(await ensureHostPermission("ftp://example.com", null), false);
  assert.equal(await ensureHostPermission("not a url", {
    contains: async () => true,
    request: async () => true,
  }), false);
});

test("ensureHostPermission grants when permissions API missing (dev)", async () => {
  assert.equal(await ensureHostPermission("https://wisprtranscriber.up.railway.app", null), true);
  assert.equal(await ensureHostPermission("http://127.0.0.1:8788", undefined), true);
});

test("ensureHostPermission skips request when origin already allowed", async () => {
  const calls = { contains: 0, request: 0 };
  const api = {
    contains: async ({ origins }) => {
      calls.contains += 1;
      assert.deepEqual(origins, ["https://custom.example:9443/*"]);
      return true;
    },
    request: async () => {
      calls.request += 1;
      return true;
    },
  };
  assert.equal(await ensureHostPermission("https://custom.example:9443/jobs", api), true);
  assert.equal(calls.contains, 1);
  assert.equal(calls.request, 0);
});

test("ensureHostPermission requests when origin not yet granted", async () => {
  const calls = { contains: 0, request: 0 };
  const api = {
    contains: async () => {
      calls.contains += 1;
      return false;
    },
    request: async ({ origins }) => {
      calls.request += 1;
      assert.deepEqual(origins, ["https://wisprtranscriber.up.railway.app/*"]);
      return true;
    },
  };
  assert.equal(
    await ensureHostPermission("https://wisprtranscriber.up.railway.app/", api),
    true,
  );
  assert.equal(calls.contains, 1);
  assert.equal(calls.request, 1);
});

test("ensureHostPermission returns false when user denies request", async () => {
  const api = {
    contains: async () => false,
    request: async () => false,
  };
  assert.equal(await ensureHostPermission("https://custom.example", api), false);
});

test("ensureHostPermission returns false when permissions API throws", async () => {
  const api = {
    contains: async () => {
      throw new Error("permissions unavailable");
    },
    request: async () => true,
  };
  assert.equal(await ensureHostPermission("http://127.0.0.1:8788", api), false);
});

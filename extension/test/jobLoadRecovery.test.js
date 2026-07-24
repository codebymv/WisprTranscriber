import assert from "node:assert/strict";
import test from "node:test";
import { resolveJobLoadRecovery } from "../src/api/jobLoadRecovery.js";

test("resolveJobLoadRecovery clears only when job is missing", () => {
  assert.equal(resolveJobLoadRecovery(new Error("Job not found.")), "clear-local");
  assert.equal(resolveJobLoadRecovery(new Error("Request failed with 404")), "clear-local");
  assert.equal(resolveJobLoadRecovery(new Error("Not Found")), "clear-local");
});

test("resolveJobLoadRecovery keeps local entry when companion is unreachable", () => {
  assert.equal(resolveJobLoadRecovery(new Error("Failed to fetch")), "keep-local");
  assert.equal(resolveJobLoadRecovery(new Error("NetworkError when attempting to fetch resource.")), "keep-local");
  assert.equal(resolveJobLoadRecovery(new Error("Request failed with 502")), "keep-local");
  assert.equal(resolveJobLoadRecovery("connection refused"), "keep-local");
  assert.equal(resolveJobLoadRecovery(null), "keep-local");
});

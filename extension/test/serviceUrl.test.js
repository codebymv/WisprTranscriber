import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SERVICE_URL,
  isValidServiceUrl,
  normalizeServiceUrl,
  serviceUrlOriginPattern,
} from "../src/api/serviceUrl.js";

test("DEFAULT_SERVICE_URL targets local companion", () => {
  assert.equal(DEFAULT_SERVICE_URL, "http://127.0.0.1:8788");
});

test("normalizeServiceUrl trims and strips trailing slashes", () => {
  assert.equal(normalizeServiceUrl("  https://wisprtranscriber.up.railway.app/  "), "https://wisprtranscriber.up.railway.app");
  assert.equal(normalizeServiceUrl("http://127.0.0.1:8788///"), "http://127.0.0.1:8788");
});

test("normalizeServiceUrl falls back to default when empty", () => {
  assert.equal(normalizeServiceUrl(""), DEFAULT_SERVICE_URL);
  assert.equal(normalizeServiceUrl("   "), DEFAULT_SERVICE_URL);
  assert.equal(normalizeServiceUrl(null), DEFAULT_SERVICE_URL);
  assert.equal(normalizeServiceUrl(undefined), DEFAULT_SERVICE_URL);
});

test("isValidServiceUrl accepts http(s) only", () => {
  assert.equal(isValidServiceUrl("http://127.0.0.1:8788"), true);
  assert.equal(isValidServiceUrl("https://wisprtranscriber.up.railway.app"), true);
  assert.equal(isValidServiceUrl("ftp://example.com"), false);
  assert.equal(isValidServiceUrl("not a url"), false);
});

test("serviceUrlOriginPattern builds chrome host permission origin", () => {
  assert.equal(serviceUrlOriginPattern("http://127.0.0.1:8788/jobs"), "http://127.0.0.1:8788/*");
  assert.equal(
    serviceUrlOriginPattern("https://wisprtranscriber.up.railway.app"),
    "https://wisprtranscriber.up.railway.app/*",
  );
  assert.equal(serviceUrlOriginPattern("ftp://bad"), null);
});

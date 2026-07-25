import assert from "node:assert/strict";
import test from "node:test";
import { corsHeaders, isAllowedCorsOrigin, resolveCorsAllowOrigin } from "../src/cors.js";

test("isAllowedCorsOrigin accepts chrome-extension origins", () => {
  assert.equal(isAllowedCorsOrigin("chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef"), true);
  assert.equal(isAllowedCorsOrigin("chrome-extension://"), false);
});

test("isAllowedCorsOrigin accepts localhost and 127.0.0.1", () => {
  assert.equal(isAllowedCorsOrigin("http://127.0.0.1:5175"), true);
  assert.equal(isAllowedCorsOrigin("http://localhost:3000"), true);
  assert.equal(isAllowedCorsOrigin("https://localhost"), true);
});

test("isAllowedCorsOrigin rejects unrelated web origins", () => {
  assert.equal(isAllowedCorsOrigin("https://evil.example"), false);
  assert.equal(isAllowedCorsOrigin("https://wisprtranscriber.up.railway.app"), false);
  assert.equal(isAllowedCorsOrigin(null), false);
  assert.equal(isAllowedCorsOrigin(""), false);
});

test("resolveCorsAllowOrigin reflects allowed Origin and uses * without Origin", () => {
  const ext = "chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef";
  assert.equal(resolveCorsAllowOrigin(undefined), "*");
  assert.equal(resolveCorsAllowOrigin(null), "*");
  assert.equal(resolveCorsAllowOrigin(ext), ext);
  assert.equal(resolveCorsAllowOrigin("https://evil.example"), null);
});

test("corsHeaders includes Allow-Origin only when resolved", () => {
  const withStar = corsHeaders(undefined);
  assert.equal(withStar["Access-Control-Allow-Origin"], "*");
  assert.match(withStar["Access-Control-Allow-Methods"], /GET/);

  const denied = corsHeaders("https://evil.example");
  assert.equal(denied["Access-Control-Allow-Origin"], undefined);
  assert.ok(denied["Access-Control-Allow-Methods"]);

  const ext = "chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef";
  assert.equal(corsHeaders(ext)["Access-Control-Allow-Origin"], ext);
});

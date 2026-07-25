import assert from "node:assert/strict";
import test from "node:test";
import { parseCompanionResponse } from "../src/api/companionResponse.js";
import { resolveUploadFailure } from "../src/api/uploadRecovery.js";

test("parseCompanionResponse returns JSON payload on success", () => {
  assert.deepEqual(parseCompanionResponse(200, true, '{"jobId":"abc"}'), { jobId: "abc" });
  assert.deepEqual(parseCompanionResponse(204, true, ""), {});
  assert.deepEqual(parseCompanionResponse(200, true, "   "), {});
});

test("parseCompanionResponse prefers JSON error field on failure", () => {
  assert.throws(
    () => parseCompanionResponse(400, false, '{"error":"Unsupported audio extension: x.txt"}'),
    (err) => {
      assert.equal(err.message, "Unsupported audio extension: x.txt");
      return true;
    },
  );
});

test("parseCompanionResponse maps non-JSON gateway bodies to status errors", () => {
  assert.throws(
    () => parseCompanionResponse(502, false, "<html>Bad Gateway</html>"),
    (err) => {
      assert.equal(err.message, "Request failed with 502");
      assert.equal(resolveUploadFailure(err), "unreachable");
      return true;
    },
  );
  assert.throws(
    () => parseCompanionResponse(503, false, "Service Unavailable"),
    (err) => {
      assert.equal(err.message, "Request failed with 503");
      assert.equal(resolveUploadFailure(err), "unreachable");
      return true;
    },
  );
});

test("parseCompanionResponse keeps non-JSON client errors as rejected uploads", () => {
  assert.throws(
    () => parseCompanionResponse(413, false, "Payload Too Large"),
    (err) => {
      assert.equal(err.message, "Request failed with 413");
      assert.equal(resolveUploadFailure(err), "rejected");
      return true;
    },
  );
});

test("parseCompanionResponse rejects invalid JSON on success", () => {
  assert.throws(
    () => parseCompanionResponse(200, true, "<html>oops</html>"),
    /Invalid companion response \(200\)/,
  );
});

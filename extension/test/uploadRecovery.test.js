import assert from "node:assert/strict";
import test from "node:test";
import { describeUploadFailure, resolveUploadFailure } from "../src/api/uploadRecovery.js";

test("resolveUploadFailure treats network / gateway drops as unreachable", () => {
  assert.equal(resolveUploadFailure(new Error("Failed to fetch")), "unreachable");
  assert.equal(
    resolveUploadFailure(new Error("NetworkError when attempting to fetch resource.")),
    "unreachable",
  );
  assert.equal(resolveUploadFailure(new Error("Load failed")), "unreachable");
  assert.equal(resolveUploadFailure(new Error("connection refused")), "unreachable");
  assert.equal(resolveUploadFailure(new Error("Request failed with 502")), "unreachable");
  assert.equal(resolveUploadFailure(new Error("Request failed with 503")), "unreachable");
  assert.equal(resolveUploadFailure(new Error("Request failed with 504")), "unreachable");
  assert.equal(resolveUploadFailure(""), "unreachable");
  assert.equal(resolveUploadFailure(null), "unreachable");
});

test("resolveUploadFailure keeps companion validation rejects as rejected", () => {
  assert.equal(
    resolveUploadFailure(new Error("Unsupported file type: notes.txt")),
    "rejected",
  );
  assert.equal(resolveUploadFailure(new Error("Upload at least one audio file.")), "rejected");
  assert.equal(resolveUploadFailure(new Error("Request failed with 400")), "rejected");
  assert.equal(resolveUploadFailure(new Error("Request failed with 413")), "rejected");
});

test("describeUploadFailure guides retry on unreachable and preserves reject copy", () => {
  assert.match(describeUploadFailure("unreachable"), /unreachable/i);
  assert.match(describeUploadFailure("unreachable"), /still selected/i);
  assert.equal(
    describeUploadFailure("rejected", "Unsupported file type: notes.txt"),
    "Unsupported file type: notes.txt",
  );
  assert.equal(describeUploadFailure("rejected", "  "), "Could not start transcription.");
});

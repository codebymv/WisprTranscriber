import assert from "node:assert/strict";
import test from "node:test";
import { validateUploadFiles } from "../src/uploadValidation.js";

function fakeFile(name, bytes) {
  const buffer = Buffer.from(bytes);
  return {
    name,
    arrayBuffer: async () =>
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
}

test("validateUploadFiles accepts supported audio", async () => {
  const result = await validateUploadFiles([fakeFile("meeting.m4a", "abc")]);
  assert.equal(result.ok, true);
  assert.equal(result.uploads.length, 1);
  assert.equal(result.uploads[0].originalName, "meeting.m4a");
  assert.equal(result.uploads[0].bytes.toString(), "abc");
});

test("validateUploadFiles rejects unsupported extensions before any job work", async () => {
  const result = await validateUploadFiles([fakeFile("notes.txt", "hello")]);
  assert.equal(result.ok, false);
  assert.match(result.error, /Unsupported audio extension/);
});

test("validateUploadFiles rejects empty audio files", async () => {
  const result = await validateUploadFiles([fakeFile("silent.mp3", "")]);
  assert.equal(result.ok, false);
  assert.match(result.error, /is empty/);
});

test("validateUploadFiles rejects when no usable file entries exist", async () => {
  const result = await validateUploadFiles([null, { name: "x.mp3" }]);
  assert.equal(result.ok, false);
  assert.match(result.error, /No valid audio files/);
});

test("validateUploadFiles fails fast on mixed supported then unsupported", async () => {
  const result = await validateUploadFiles([
    fakeFile("ok.wav", "data"),
    fakeFile("bad.docx", "nope"),
  ]);
  assert.equal(result.ok, false);
  assert.match(result.error, /bad\.docx/);
});

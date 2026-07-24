import assert from "node:assert/strict";
import test from "node:test";
import {
  CHUNK_SECONDS,
  TARGET_CHUNK_BYTES,
  computeChunkSegmentSeconds,
  isSupportedAudioFile,
  safeBaseName,
} from "../src/config.js";

test("audio extension validation accepts OpenAI-supported formats", () => {
  assert.equal(isSupportedAudioFile("meeting.m4a"), true);
  assert.equal(isSupportedAudioFile("meeting.mp3"), true);
  assert.equal(isSupportedAudioFile("meeting.wav"), true);
  assert.equal(isSupportedAudioFile("notes.txt"), false);
});

test("safeBaseName strips unsafe filename characters", () => {
  assert.equal(safeBaseName("Paul Meeting #5.m4a"), "Paul-Meeting-5");
  assert.equal(safeBaseName("!!!.mp3"), "audio");
});

test("computeChunkSegmentSeconds skips split for small short files", () => {
  assert.equal(computeChunkSegmentSeconds(1_000_000, 10 * 60), null);
});

test("computeChunkSegmentSeconds caps long files at 45 minutes", () => {
  assert.equal(computeChunkSegmentSeconds(1_000_000, 3 * 60 * 60), CHUNK_SECONDS);
});

test("computeChunkSegmentSeconds shortens when compressed size exceeds target", () => {
  const duration = 3 * 60 * 60;
  const size = TARGET_CHUNK_BYTES * 6;
  const segment = computeChunkSegmentSeconds(size, duration);
  assert.ok(segment != null);
  assert.ok(segment < CHUNK_SECONDS);
  assert.ok(segment >= 60);
  assert.equal(segment, Math.floor(duration / 6));
});

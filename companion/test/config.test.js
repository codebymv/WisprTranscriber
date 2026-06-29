import assert from "node:assert/strict";
import test from "node:test";
import { isSupportedAudioFile, safeBaseName } from "../src/config.js";

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

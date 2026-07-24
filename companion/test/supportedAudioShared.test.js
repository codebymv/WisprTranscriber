import assert from "node:assert/strict";
import test from "node:test";
import {
  SUPPORTED_AUDIO_EXTENSIONS,
  audioFileExtension,
  isSupportedAudioFileName,
  supportedAudioAcceptAttribute,
} from "../src/supportedAudio.js";
import {
  SUPPORTED_EXTENSIONS,
  isSupportedAudioFile,
} from "../src/config.js";
import * as sharedSupportedAudio from "../../shared/supportedAudio.js";

test("shared list covers OpenAI-supported Whisper upload formats", () => {
  assert.deepEqual([...SUPPORTED_AUDIO_EXTENSIONS], [
    ".mp3",
    ".mp4",
    ".mpeg",
    ".mpga",
    ".m4a",
    ".wav",
    ".webm",
  ]);
});

test("isSupportedAudioFileName accepts and rejects by extension", () => {
  assert.equal(isSupportedAudioFileName("meeting.m4a"), true);
  assert.equal(isSupportedAudioFileName("Meeting.MP3"), true);
  assert.equal(isSupportedAudioFileName("clip.webm"), true);
  assert.equal(isSupportedAudioFileName("notes.txt"), false);
  assert.equal(isSupportedAudioFileName("noext"), false);
  assert.equal(isSupportedAudioFileName(""), false);
});

test("audioFileExtension normalizes case and missing dots", () => {
  assert.equal(audioFileExtension("a.WAV"), ".wav");
  assert.equal(audioFileExtension("plain"), "");
});

test("accept attribute lists every shared extension plus audio/*", () => {
  const accept = supportedAudioAcceptAttribute();
  for (const ext of SUPPORTED_AUDIO_EXTENSIONS) {
    assert.match(accept, new RegExp(`(?:^|,)${ext.replace(".", "\\.")}(?:,|$)`));
  }
  assert.match(accept, /(?:^|,)audio\/\*(?:,|$)/);
});

test("companion config re-exports the shared extension set", () => {
  assert.deepEqual([...SUPPORTED_EXTENSIONS].sort(), [...SUPPORTED_AUDIO_EXTENSIONS].sort());
  for (const name of ["a.m4a", "b.mp3", "c.txt", "d", "E.WaV"]) {
    assert.equal(isSupportedAudioFile(name), isSupportedAudioFileName(name));
  }
});

test("repo shared/ re-exports the companion module (extension import path)", () => {
  assert.equal(
    sharedSupportedAudio.SUPPORTED_AUDIO_EXTENSIONS,
    SUPPORTED_AUDIO_EXTENSIONS,
  );
  assert.equal(sharedSupportedAudio.isSupportedAudioFileName("x.m4a"), true);
});

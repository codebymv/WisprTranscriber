import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  CRITICAL_MODULE_SPECIFIERS,
  assertBootReady,
  checkBoot,
  isInsideCompanionRoot,
  resolveCompanionModule,
} from "../src/bootCheck.js";

/** Inventable deploy-root fixture (path.resolve-normalized for Win/Unix). */
function fixtureRoot(name = "app") {
  const companionRoot = path.resolve(path.sep, "wispr-boot-fixture", name);
  return { companionRoot, srcDir: path.join(companionRoot, "src") };
}

test("isInsideCompanionRoot accepts in-tree paths and rejects escapes", () => {
  const { companionRoot } = fixtureRoot();
  assert.equal(
    isInsideCompanionRoot(companionRoot, path.join(companionRoot, "src", "supportedAudio.js")),
    true,
  );
  assert.equal(isInsideCompanionRoot(companionRoot, companionRoot), true);
  assert.equal(
    isInsideCompanionRoot(companionRoot, path.resolve(path.sep, "shared", "supportedAudio.js")),
    false,
  );
  assert.equal(
    isInsideCompanionRoot(
      companionRoot,
      path.join(companionRoot, "..", "shared", "supportedAudio.js"),
    ),
    false,
  );
});

test("resolveCompanionModule rejects ../../shared escape (Railway crash class)", () => {
  const { companionRoot, srcDir } = fixtureRoot();
  const result = resolveCompanionModule("../../shared/supportedAudio.js", {
    srcDir,
    companionRoot,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /outside companion deploy root/);
  assert.match(result.error, /\.\.\/\.\.\/shared/);
});

test("resolveCompanionModule accepts in-tree relative modules", () => {
  const { companionRoot, srcDir } = fixtureRoot();
  const result = resolveCompanionModule("./supportedAudio.js", { srcDir, companionRoot });
  assert.equal(result.ok, true);
  assert.equal(result.path, path.resolve(srcDir, "supportedAudio.js"));
});

test("checkBoot fails fast with clear error when critical module is missing", async () => {
  const { companionRoot, srcDir } = fixtureRoot();
  const result = await checkBoot({
    srcDir,
    companionRoot,
    modules: ["./supportedAudio.js", "./server.js"],
    exists: async () => false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /supportedAudio/);
  assert.match(result.errors[0], /Deploy root must be companion/);
  assert.match(result.errors[1], /server\.js/);
});

test("checkBoot fails when any module escapes deploy root", async () => {
  const { companionRoot, srcDir } = fixtureRoot();
  const result = await checkBoot({
    srcDir,
    companionRoot,
    modules: ["./config.js", "../../shared/supportedAudio.js"],
    exists: async (p) => p === path.resolve(srcDir, "config.js"),
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /outside companion deploy root/);
});

test("checkBoot passes when inventable modules exist inside root", async () => {
  const { companionRoot, srcDir } = fixtureRoot();
  const present = new Set([
    path.resolve(srcDir, "supportedAudio.js"),
    path.resolve(srcDir, "server.js"),
  ]);
  const result = await checkBoot({
    srcDir,
    companionRoot,
    modules: ["./supportedAudio.js", "./server.js"],
    exists: async (p) => present.has(p),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("assertBootReady throws a multi-line boot failure", async () => {
  const { companionRoot, srcDir } = fixtureRoot();
  await assert.rejects(
    () =>
      assertBootReady({
        srcDir,
        companionRoot,
        modules: ["./supportedAudio.js"],
        exists: async () => false,
      }),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Companion boot self-check failed/);
      assert.match(err.message, /supportedAudio/);
      return true;
    },
  );
});

test("real companion tree: critical modules resolve for current deploy layout", async () => {
  assert.ok(CRITICAL_MODULE_SPECIFIERS.includes("./supportedAudio.js"));
  assert.ok(CRITICAL_MODULE_SPECIFIERS.includes("./server.js"));
  const result = await checkBoot();
  assert.equal(result.ok, true, result.errors.join("\n"));
  await assertBootReady();
});

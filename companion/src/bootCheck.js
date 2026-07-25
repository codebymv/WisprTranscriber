/**
 * Fail-fast boot self-check for companion deploy root (Railway/Docker = companion/).
 * Catches missing critical modules and imports that escape the companion tree
 * (e.g. ../../shared → /shared when WORKDIR is /app).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const COMPANION_ROOT = path.resolve(__dirname, "..");
export const COMPANION_SRC = path.join(COMPANION_ROOT, "src");

/** Specifiers relative to companion/src that must exist for server boot. */
export const CRITICAL_MODULE_SPECIFIERS = Object.freeze([
  "./supportedAudio.js",
  "./config.js",
  "./cors.js",
  "./jobs.js",
  "./process.js",
  "./transcribe.js",
  "./uploadValidation.js",
  "./server.js",
]);

/**
 * True when `target` is companionRoot or a path inside it.
 */
export function isInsideCompanionRoot(companionRoot, target) {
  const root = path.resolve(companionRoot);
  const resolved = path.resolve(target);
  const rel = path.relative(root, resolved);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolve a relative specifier against srcDir and ensure it stays in companion/.
 */
export function resolveCompanionModule(specifier, options = {}) {
  const srcDir = path.resolve(options.srcDir ?? COMPANION_SRC);
  const companionRoot = path.resolve(options.companionRoot ?? path.join(srcDir, ".."));

  if (typeof specifier !== "string" || specifier.length === 0) {
    return {
      ok: false,
      path: null,
      error: "Empty module specifier.",
    };
  }

  // Only relative paths are deploy-root sensitive; leave bare/node: alone.
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return { ok: true, path: null, error: null };
  }

  const resolved = path.resolve(srcDir, specifier);
  if (!isInsideCompanionRoot(companionRoot, resolved)) {
    return {
      ok: false,
      path: resolved,
      error:
        `Module "${specifier}" resolves outside companion deploy root (${companionRoot}). ` +
        `Got: ${resolved}. Do not import ../../shared when Railway/Docker root is companion/.`,
    };
  }

  return { ok: true, path: resolved, error: null };
}

async function defaultExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check that critical companion modules resolve inside the deploy root and exist.
 * @param {{ srcDir?: string, companionRoot?: string, modules?: string[], exists?: (p: string) => Promise<boolean> }} [options]
 */
export async function checkBoot(options = {}) {
  const srcDir = path.resolve(options.srcDir ?? COMPANION_SRC);
  const companionRoot = path.resolve(options.companionRoot ?? path.join(srcDir, ".."));
  const modules = options.modules ?? CRITICAL_MODULE_SPECIFIERS;
  const exists = options.exists ?? defaultExists;
  const errors = [];

  for (const specifier of modules) {
    const resolved = resolveCompanionModule(specifier, { srcDir, companionRoot });
    if (!resolved.ok) {
      errors.push(resolved.error);
      continue;
    }
    if (resolved.path != null && !(await exists(resolved.path))) {
      errors.push(
        `Critical module missing: "${specifier}" (expected at ${resolved.path}). ` +
          "Deploy root must be companion/ and include src/.",
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

export async function assertBootReady(options = {}) {
  const result = await checkBoot(options);
  if (!result.ok) {
    throw new Error(`Companion boot self-check failed:\n- ${result.errors.join("\n- ")}`);
  }
  return result;
}

export async function runBootCheckCli(options = {}) {
  const result = await checkBoot(options);
  if (!result.ok) {
    console.error(`Companion boot self-check failed:\n- ${result.errors.join("\n- ")}`);
    return 1;
  }
  console.log(
    `Companion boot self-check ok (${(options.modules ?? CRITICAL_MODULE_SPECIFIERS).length} modules, root=${path.resolve(options.companionRoot ?? COMPANION_ROOT)}).`,
  );
  return 0;
}

const isMain =
  process.argv[1] != null &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMain) {
  process.exitCode = await runBootCheckCli();
}

import fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  TARGET_CHUNK_BYTES,
  computeChunkSegmentSeconds,
  ffprobePathFor,
  safeBaseName,
} from "./config.js";
import {
  JobCancelledError,
  addArtifact,
  addLog,
  getJobSignal,
  throwIfCancelled,
  updateJob,
} from "./jobs.js";
import { transcribeWithOpenAI } from "./transcribe.js";

export async function runJob(job, uploads, config) {
  try {
    throwIfCancelled(job);
    updateJob(job, {
      status: "running",
      stage: "Preparing workspace",
      progress: 3,
      files: uploads.map((file) => ({
        name: file.originalName,
        size: file.size,
      })),
    });

    const jobDir = path.join(config.dataDir, "jobs", job.jobId);
    await mkdir(jobDir, { recursive: true });

    const partTranscripts = [];
    const totalFiles = uploads.length;
    const signal = getJobSignal(job);

    for (let fileIndex = 0; fileIndex < uploads.length; fileIndex += 1) {
      throwIfCancelled(job);
      const upload = uploads[fileIndex];
      const base = safeBaseName(upload.originalName);
      const fileLabel = `${fileIndex + 1}/${totalFiles}`;
      addLog(job, `Processing ${upload.originalName}`);

      updateJob(job, {
        stage: `Probing file ${fileLabel}`,
        progress: percent(fileIndex, totalFiles, 8),
      });
      const duration = await probeDuration(upload.path, config, signal);
      addLog(job, `Duration: ${formatDuration(duration)}`);

      throwIfCancelled(job);
      updateJob(job, {
        stage: `Compressing file ${fileLabel}`,
        progress: percent(fileIndex, totalFiles, 18),
      });
      const compressedPath = path.join(jobDir, `${base}_compressed.mp3`);
      await compressAudio(upload.path, compressedPath, config, signal);
      addArtifact(job, {
        kind: "audio",
        label: `${base}_compressed.mp3`,
        path: compressedPath,
        contentType: "audio/mpeg",
      });

      const compressedSize = fs.statSync(compressedPath).size;
      addLog(job, `Compressed size: ${formatBytes(compressedSize)}`);

      throwIfCancelled(job);
      updateJob(job, {
        stage: `Splitting file ${fileLabel}`,
        progress: percent(fileIndex, totalFiles, 30),
      });
      const chunks = await splitIfNeeded(
        compressedPath,
        base,
        jobDir,
        compressedSize,
        duration,
        config,
        job,
        signal,
      );
      addLog(job, `Transcription chunks: ${chunks.length}`);
      for (const chunkPath of chunks) {
        if (chunkPath !== compressedPath) {
          addArtifact(job, {
            kind: "audio",
            label: path.basename(chunkPath),
            path: chunkPath,
            contentType: "audio/mpeg",
          });
        }
      }

      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        throwIfCancelled(job);
        const chunkPath = chunks[chunkIndex];
        updateJob(job, {
          stage: `Transcribing file ${fileLabel}, part ${chunkIndex + 1}/${chunks.length} with OpenAI`,
          progress: percent(fileIndex, totalFiles, 68 + Math.round((chunkIndex / chunks.length) * 18)),
        });

        const text = await transcribeWithRetry(chunkPath, config, job, signal);
        const transcriptName =
          chunks.length === 1 ? `${base}_compressed.txt` : `${base}_part-${chunkIndex + 1}.txt`;
        const transcriptPath = path.join(jobDir, transcriptName);
        await writeFile(transcriptPath, text, "utf8");
        addArtifact(job, {
          kind: "transcript",
          label: transcriptName,
          path: transcriptPath,
          contentType: "text/plain; charset=utf-8",
        });
        partTranscripts.push({
          label: `${base}${chunks.length > 1 ? ` part ${chunkIndex + 1}` : ""}`,
          source: upload.originalName,
          text,
        });
      }
    }

    throwIfCancelled(job);
    updateJob(job, {
      stage: "Merging transcript",
      progress: 92,
    });

    const jobBase = safeBaseName(job.jobName || uploads[0]?.originalName || "wispr-transcript");
    const mergedMarkdown = buildMergedTranscript(partTranscripts);
    const mergedText = markdownToPlainText(mergedMarkdown);
    const txtPath = path.join(jobDir, `${jobBase}-full-transcript.txt`);
    const mdPath = path.join(jobDir, `${jobBase}-full-transcript.md`);
    await writeFile(txtPath, mergedText, "utf8");
    await writeFile(mdPath, mergedMarkdown, "utf8");
    addArtifact(job, {
      kind: "transcript",
      label: path.basename(txtPath),
      path: txtPath,
      contentType: "text/plain; charset=utf-8",
    });
    addArtifact(job, {
      kind: "transcript",
      label: path.basename(mdPath),
      path: mdPath,
      contentType: "text/markdown; charset=utf-8",
    });

    updateJob(job, {
      status: "done",
      stage: "Done",
      progress: 100,
    });
    addLog(job, "Job complete");
  } catch (error) {
    if (isCancellation(error, job)) {
      if (job.status !== "cancelled" && !job.cleanedUp) {
        updateJob(job, {
          status: "cancelled",
          stage: "Cancelled",
          error: "Cancelled by user.",
        });
        addLog(job, "Job cancelled.");
      }
      return;
    }
    updateJob(job, {
      status: "error",
      stage: "Failed",
      error: error instanceof Error ? error.message : String(error),
    });
    addLog(job, `Error: ${job.error}`);
  }
}

async function probeDuration(inputPath, config, signal) {
  const ffprobePath = ffprobePathFor(config.ffmpegPath);
  const output = await runProcess(
    ffprobePath,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      inputPath,
    ],
    signal,
  );
  const duration = Number(output.trim());
  return Number.isFinite(duration) ? duration : 0;
}

async function compressAudio(inputPath, outputPath, config, signal) {
  await runProcess(
    config.ffmpegPath,
    ["-y", "-i", inputPath, "-vn", "-ac", "1", "-b:a", "20k", "-ar", "16000", outputPath],
    signal,
  );
}

async function splitIfNeeded(
  compressedPath,
  base,
  jobDir,
  compressedSize,
  duration,
  config,
  job,
  signal,
) {
  const segmentSeconds = computeChunkSegmentSeconds(compressedSize, duration);
  if (segmentSeconds == null) {
    return [compressedPath];
  }

  addLog(job, `Splitting into ~${Math.round(segmentSeconds / 60)} minute chunks`);
  let chunkFiles = await segmentAudio(compressedPath, base, jobDir, segmentSeconds, config, {
    copyCodec: true,
    signal,
  });

  // Stream-copy splits can leave a chunk still over the API size limit; re-encode shorter.
  const oversized = chunkFiles.filter((file) => fs.statSync(file).size > TARGET_CHUNK_BYTES);
  if (oversized.length > 0) {
    const shorter = Math.max(60, Math.floor(segmentSeconds / 2));
    addLog(
      job,
      `${oversized.length} chunk(s) still over size limit; re-encoding at ~${Math.round(shorter / 60)} minute segments`,
    );
    chunkFiles = await segmentAudio(compressedPath, base, jobDir, shorter, config, {
      copyCodec: false,
      signal,
    });
  }

  return chunkFiles.length > 0 ? chunkFiles : [compressedPath];
}

async function segmentAudio(inputPath, base, jobDir, segmentSeconds, config, { copyCodec, signal }) {
  const partPrefix = `${base}_part-`;
  for (const file of fs.readdirSync(jobDir)) {
    if (file.startsWith(partPrefix) && file.endsWith(".mp3")) {
      fs.unlinkSync(path.join(jobDir, file));
    }
  }

  const chunkPattern = path.join(jobDir, `${partPrefix}%03d.mp3`);
  const args = ["-y", "-i", inputPath];
  if (copyCodec) {
    args.push("-c", "copy");
  } else {
    args.push("-vn", "-ac", "1", "-b:a", "20k", "-ar", "16000");
  }
  args.push(
    "-f",
    "segment",
    "-segment_time",
    String(segmentSeconds),
    "-reset_timestamps",
    "1",
    chunkPattern,
  );
  await runProcess(config.ffmpegPath, args, signal);

  return fs
    .readdirSync(jobDir)
    .filter((file) => /^.*_part-\d{3}\.mp3$/i.test(file) && file.startsWith(partPrefix))
    .sort()
    .map((file) => path.join(jobDir, file))
    .filter((filePath) => {
      try {
        return fs.statSync(filePath).size >= 1024;
      } catch {
        return false;
      }
    });
}

async function transcribeWithRetry(filePath, config, job, signal) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    throwIfCancelled(job);
    try {
      addLog(job, `Transcribing ${path.basename(filePath)} (attempt ${attempt}/3)`);
      return await transcribeWithOpenAI(filePath, config, { signal });
    } catch (error) {
      if (isCancellation(error, job)) throw error;
      lastError = error;
      addLog(job, `Attempt ${attempt} failed: ${error.message}`);
      if (attempt < 3) await delay(attempt * 1500, signal);
    }
  }
  throw lastError;
}

function buildMergedTranscript(parts) {
  return parts
    .map((part, index) => `## Part ${index + 1} - ${part.label}\n\n${part.text.trim()}\n`)
    .join("\n");
}

function markdownToPlainText(markdown) {
  return markdown.replace(/^## /gm, "").trimEnd() + "\n";
}

function percent(fileIndex, totalFiles, innerPercent) {
  const perFile = 84 / Math.max(totalFiles, 1);
  return Math.min(96, Math.round(6 + fileIndex * perFile + (innerPercent / 100) * perFile));
}

/** Exported for cancel/abort unit tests. */
export function runProcess(command, args, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new JobCancelledError());
      return;
    }

    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const settle = (fn) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      fn();
    };

    const onAbort = () => {
      try {
        child.kill();
      } catch {
        /* Process may already be gone. */
      }
      settle(() => reject(new JobCancelledError()));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => settle(() => reject(error)));
    child.on("close", (code) => {
      if (signal?.aborted) {
        settle(() => reject(new JobCancelledError()));
        return;
      }
      if (code === 0) {
        settle(() => resolve(stdout));
        return;
      }
      settle(() =>
        reject(new Error(`${path.basename(command)} exited with code ${code}: ${stderr || stdout}`)),
      );
    });
  });
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new JobCancelledError());
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new JobCancelledError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isCancellation(error, job) {
  return (
    error instanceof JobCancelledError ||
    job.status === "cancelled" ||
    job.cleanedUp ||
    Boolean(job.cancelController?.signal.aborted) ||
    (error instanceof Error && /aborted|cancelled/i.test(error.message))
  );
}

function formatDuration(seconds) {
  const rounded = Math.round(seconds);
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  return [h, m, s].map((part) => String(part).padStart(2, "0")).join(":");
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

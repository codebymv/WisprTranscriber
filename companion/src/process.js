import fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  CHUNK_SECONDS,
  TARGET_CHUNK_BYTES,
  ffprobePathFor,
  safeBaseName,
} from "./config.js";
import { addArtifact, addLog, updateJob } from "./jobs.js";
import { transcribeWithOpenAI } from "./transcribe.js";

export async function runJob(job, uploads, config) {
  try {
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

    for (let fileIndex = 0; fileIndex < uploads.length; fileIndex += 1) {
      const upload = uploads[fileIndex];
      const base = safeBaseName(upload.originalName);
      const fileLabel = `${fileIndex + 1}/${totalFiles}`;
      addLog(job, `Processing ${upload.originalName}`);

      updateJob(job, {
        stage: `Probing file ${fileLabel}`,
        progress: percent(fileIndex, totalFiles, 8),
      });
      const duration = await probeDuration(upload.path, config);
      addLog(job, `Duration: ${formatDuration(duration)}`);

      updateJob(job, {
        stage: `Compressing file ${fileLabel}`,
        progress: percent(fileIndex, totalFiles, 18),
      });
      const compressedPath = path.join(jobDir, `${base}_compressed.mp3`);
      await compressAudio(upload.path, compressedPath, config);
      addArtifact(job, {
        kind: "audio",
        label: `${base}_compressed.mp3`,
        path: compressedPath,
        contentType: "audio/mpeg",
      });

      const compressedSize = fs.statSync(compressedPath).size;
      addLog(job, `Compressed size: ${formatBytes(compressedSize)}`);

      updateJob(job, {
        stage: `Splitting file ${fileLabel}`,
        progress: percent(fileIndex, totalFiles, 30),
      });
      const chunks = await splitIfNeeded(compressedPath, base, jobDir, compressedSize, config);
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
        const chunkPath = chunks[chunkIndex];
        updateJob(job, {
          stage: `Transcribing file ${fileLabel}, part ${chunkIndex + 1}/${chunks.length}`,
          progress: percent(fileIndex, totalFiles, 42 + Math.round((chunkIndex / chunks.length) * 38)),
        });

        const text = await transcribeWithRetry(chunkPath, config, job);
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
    updateJob(job, {
      status: "error",
      stage: "Failed",
      error: error instanceof Error ? error.message : String(error),
    });
    addLog(job, `Error: ${job.error}`);
  }
}

async function probeDuration(inputPath, config) {
  const ffprobePath = ffprobePathFor(config.ffmpegPath);
  const output = await runProcess(ffprobePath, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    inputPath,
  ]);
  const duration = Number(output.trim());
  return Number.isFinite(duration) ? duration : 0;
}

async function compressAudio(inputPath, outputPath, config) {
  await runProcess(config.ffmpegPath, [
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-ac",
    "1",
    "-b:a",
    "20k",
    "-ar",
    "16000",
    outputPath,
  ]);
}

async function splitIfNeeded(compressedPath, base, jobDir, compressedSize, config) {
  if (compressedSize <= TARGET_CHUNK_BYTES) return [compressedPath];

  const chunkPattern = path.join(jobDir, `${base}_part-%03d.mp3`);
  await runProcess(config.ffmpegPath, [
    "-y",
    "-i",
    compressedPath,
    "-c",
    "copy",
    "-f",
    "segment",
    "-segment_time",
    String(CHUNK_SECONDS),
    "-reset_timestamps",
    "1",
    chunkPattern,
  ]);

  const chunkFiles = fs
    .readdirSync(jobDir)
    .filter((file) => file.startsWith(`${base}_part-`) && file.endsWith(".mp3"))
    .sort()
    .map((file) => path.join(jobDir, file));

  return chunkFiles.length > 0 ? chunkFiles : [compressedPath];
}

async function transcribeWithRetry(filePath, config, job) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      addLog(job, `Transcribing ${path.basename(filePath)} (attempt ${attempt}/3)`);
      return await transcribeWithOpenAI(filePath, config);
    } catch (error) {
      lastError = error;
      addLog(job, `Attempt ${attempt} failed: ${error.message}`);
      if (attempt < 3) await delay(attempt * 1500);
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

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(`${path.basename(command)} exited with code ${code}: ${stderr || stdout}`));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

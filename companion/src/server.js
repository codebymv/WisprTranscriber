import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertBootReady } from "./bootCheck.js";
import {
  VERSION,
  executableExists,
  getConfig,
  loadDotEnv,
  safeBaseName,
} from "./config.js";
import {
  addLog,
  cancelAndCleanupJob,
  createJob,
  getJob,
  serializeJob,
  setJobsDataDir,
  subscribeJob,
} from "./jobs.js";
import { runJob } from "./process.js";
import { validateUploadFiles } from "./uploadValidation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await assertBootReady();
loadDotEnv(path.resolve(__dirname, "..", ".env"));

const config = getConfig();
setJobsDataDir(config.dataDir);
await mkdir(config.dataDir, { recursive: true });

const server = http.createServer(async (req, res) => {
  try {
    if (handleCors(req, res)) return;

    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, healthPayload());
    }

    if (req.method === "POST" && url.pathname === "/jobs") {
      return await handleCreateJob(req, res);
    }

    const jobMatch = url.pathname.match(/^\/jobs\/([^/]+)$/);
    if (req.method === "GET" && jobMatch) {
      const job = getJob(jobMatch[1]);
      if (!job) return sendJson(res, 404, { error: "Job not found." });
      return sendJson(res, 200, serializeJob(job));
    }
    if (req.method === "DELETE" && jobMatch) {
      return handleDeleteJob(jobMatch[1], res);
    }

    const eventsMatch = url.pathname.match(/^\/jobs\/([^/]+)\/events$/);
    if (req.method === "GET" && eventsMatch) {
      return handleJobEvents(eventsMatch[1], res);
    }

    const artifactMatch = url.pathname.match(/^\/jobs\/([^/]+)\/artifacts\/([^/]+)$/);
    if (req.method === "GET" && artifactMatch) {
      return handleArtifactDownload(artifactMatch[1], artifactMatch[2], res);
    }

    sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Wispr companion listening on http://${config.host}:${config.port}`);
  console.log(`ffmpeg command: ${config.ffmpegPath}`);
});

async function handleCreateJob(req, res) {
  const form = await parseMultipartForm(req);
  const jobNameRaw = form.get("jobName");
  const jobName = typeof jobNameRaw === "string" ? jobNameRaw.trim() : "";
  const files = form.getAll("files");

  if (files.length === 0) {
    return sendJson(res, 400, { error: "Upload at least one audio file." });
  }

  // Validate before createJob so bad uploads never leave orphaned queued jobs.
  const validated = await validateUploadFiles(files);
  if (!validated.ok) {
    return sendJson(res, 400, { error: validated.error });
  }

  const job = createJob(
    jobName || safeBaseName(validated.uploads[0].originalName || "wispr-job"),
  );
  const uploadDir = path.join(config.dataDir, "jobs", job.jobId, "uploads");
  await mkdir(uploadDir, { recursive: true });

  const uploads = [];
  for (const file of validated.uploads) {
    const safeName = `${uploads.length + 1}-${safeBaseName(file.originalName)}${path.extname(file.originalName)}`;
    const uploadPath = path.join(uploadDir, safeName);
    await writeFile(uploadPath, file.bytes);
    uploads.push({
      originalName: file.originalName,
      path: uploadPath,
      size: file.bytes.length,
    });
  }

  addLog(job, `Queued ${uploads.length} file(s).`);
  sendJson(res, 202, { jobId: job.jobId });
  runJob(job, uploads, config);
}

async function parseMultipartForm(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const request = new Request("http://127.0.0.1/jobs", {
    method: "POST",
    headers: {
      "content-type": req.headers["content-type"] ?? "",
    },
    body,
  });
  return request.formData();
}

function handleDeleteJob(jobId, res) {
  const existing = getJob(jobId);
  if (!existing) return sendJson(res, 404, { error: "Job not found." });

  const snapshot = serializeJob(existing);
  cancelAndCleanupJob(jobId);
  return sendJson(res, 200, {
    ok: true,
    jobId,
    cancelled: snapshot.status === "queued" || snapshot.status === "running",
    cleanedUp: true,
  });
}

function handleJobEvents(jobId, res) {
  const job = getJob(jobId);
  if (!job) return sendJson(res, 404, { error: "Job not found." });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    ...corsHeaders(),
  });

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const unsubscribe = subscribeJob(job, send);
  const heartbeat = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 15000);
  res.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

function handleArtifactDownload(jobId, artifactId, res) {
  const job = getJob(jobId);
  if (!job) return sendJson(res, 404, { error: "Job not found." });
  const artifact = job.artifacts.find((item) => item.id === artifactId);
  if (!artifact) return sendJson(res, 404, { error: "Artifact not found." });
  if (!fs.existsSync(artifact.path)) return sendJson(res, 404, { error: "Artifact file is missing." });

  res.writeHead(200, {
    "Content-Type": artifact.contentType,
    "Content-Disposition": `attachment; filename="${artifact.label.replaceAll('"', "")}"`,
    ...corsHeaders(),
  });
  fs.createReadStream(artifact.path).pipe(res);
}

function healthPayload() {
  return {
    ok: Boolean(config.apiKey) && executableExists(config.ffmpegPath),
    version: VERSION,
    hasApiKey: Boolean(config.apiKey),
    ffmpegFound: executableExists(config.ffmpegPath),
    ffmpegPath: config.ffmpegPath,
    model: config.model,
  };
}

function handleCors(req, res) {
  if (req.method !== "OPTIONS") return false;
  res.writeHead(204, corsHeaders());
  res.end();
  return true;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(),
  });
  res.end(JSON.stringify(payload));
}

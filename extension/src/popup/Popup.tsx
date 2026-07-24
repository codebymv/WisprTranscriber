import { ChangeEvent, useEffect, useRef, useState } from "react";
import {
  artifactUrl,
  cancelAndCleanupJob,
  createJob,
  eventsUrl,
  getHealth,
  getJob,
} from "../api/client";
import {
  probeJobAfterFailedCancel,
  resolveFailedCancelRecovery,
} from "../api/cancelRecovery.js";
import {
  describeCompanionHealth,
  describeJobTransport,
  healthDotState,
  resolveRetrySuccessToast,
} from "../api/companionStatus.js";
import { resolveJobLoadRecovery } from "../api/jobLoadRecovery.js";
import { describeUploadFailure, resolveUploadFailure } from "../api/uploadRecovery.js";
import { createJobEventWatcher, JobEventTransport, JobEventWatcher } from "../api/jobEvents.js";
import { DEFAULT_SETTINGS, HealthPayload, JobPayload } from "../api/types";
import {
  supportedAudioAcceptAttribute,
  validateSelectedAudioFiles,
} from "../audio/supportedAudio";
import { clearJobSession, loadJobSession, saveJobSession } from "../storage/jobSession";
import { loadRecentJobs, RecentJob, removeRecentJob, upsertRecentJob } from "../storage/recentJobs";

const SERVICE_URL = DEFAULT_SETTINGS.serviceUrl;

export function Popup() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [healthReachError, setHealthReachError] = useState<string | null>(null);
  const [healthRefreshing, setHealthRefreshing] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [jobName, setJobName] = useState("");
  const [job, setJob] = useState<JobPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedSignature, setCompletedSignature] = useState<string | null>(null);
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);
  const [selectedRecentId, setSelectedRecentId] = useState("");
  const [jobTransport, setJobTransport] = useState<JobEventTransport | null>(null);
  const [isWatching, setIsWatching] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [retryToast, setRetryToast] = useState<string | null>(null);
  const watcherRef = useRef<JobEventWatcher | null>(null);
  /** Bumped on stop/cancel so in-flight attach/poll work cannot resurrect UI. */
  const watchGenerationRef = useRef(0);
  /** Wall clock when companion first became unreachable (for long-outage toast). */
  const unreachableSinceRef = useRef<number | null>(null);
  const retryToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    refreshHealth();

    // Load recents before session resume so a missing-job cleanup cannot race
    // with the initial recent-list write and resurrect a dropped entry.
    void (async () => {
      try {
        setRecentJobs(await loadRecentJobs());
      } catch {
        /* Storage failures should not block popup use. */
      }

      try {
        const session = await loadJobSession();
        if (!session) return;
        setJobName(session.jobName);
        setSelectedRecentId(session.jobId);
        try {
          await attachToJob(session.jobId, session.fileSignature);
        } catch (err) {
          if (resolveJobLoadRecovery(err) === "clear-local") {
            await clearJobSession();
            setRecentJobs(await removeRecentJob(session.jobId));
            setSelectedRecentId("");
            return;
          }
          // Companion unreachable: keep session so the next open can resume.
          setError(err instanceof Error ? err.message : "Could not resume the active job.");
        }
      } catch {
        /* A stale session should not block normal popup use. */
      }
    })();

    return () => {
      stopWatching();
      if (retryToastTimerRef.current != null) {
        clearTimeout(retryToastTimerRef.current);
        retryToastTimerRef.current = null;
      }
    };
  }, []);

  function stopWatching() {
    watchGenerationRef.current += 1;
    watcherRef.current?.stop();
    watcherRef.current = null;
    setIsWatching(false);
    setJobTransport(null);
  }

  function showRetryToast(message: string) {
    if (retryToastTimerRef.current != null) {
      clearTimeout(retryToastTimerRef.current);
      retryToastTimerRef.current = null;
    }
    setRetryToast(message);
    retryToastTimerRef.current = setTimeout(() => {
      setRetryToast(null);
      retryToastTimerRef.current = null;
    }, 3200);
  }

  async function refreshHealth() {
    const wasUnreachable = unreachableSinceRef.current != null || healthReachError != null;
    const unreachableSinceMs = unreachableSinceRef.current;
    setHealthRefreshing(true);
    try {
      const payload = await getHealth(SERVICE_URL);
      setHealth(payload);
      setHealthReachError(null);
      unreachableSinceRef.current = null;
      const toast = resolveRetrySuccessToast({
        wasUnreachable,
        recovered: true,
        unreachableSinceMs,
      });
      if (toast) showRetryToast(toast.message);
    } catch (err) {
      setHealth(null);
      setHealthReachError(err instanceof Error ? err.message : "Could not reach Wispr Cloud.");
      if (unreachableSinceRef.current == null) {
        unreachableSinceRef.current = Date.now();
      }
    } finally {
      setHealthRefreshing(false);
    }
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
    setFiles(selected);
    if (selected.length > 0 && !jobName) setJobName(defaultJobName(selected[0].name));
    setJob(null);
    setError(null);
    setCompletedSignature(null);
    setSelectedRecentId("");
    clearJobSession();
  }

  async function handleCancel() {
    if (!job || !busy || cancelling) return;

    const jobId = job.jobId;
    const fileSignature = getFileSignature(files);
    setError(null);
    setCancelling(true);
    // Tear down SSE/poll immediately so mid-reconnect work cannot race cleanup.
    stopWatching();

    try {
      await cancelAndCleanupJob(SERVICE_URL, jobId);
      await clearJobSession();
      const next = await removeRecentJob(jobId);
      setRecentJobs(next);
      setSelectedRecentId("");
      setJob(null);
      setBusy(false);
      setCompletedSignature(null);
    } catch (err) {
      const cancelMessage =
        err instanceof Error ? err.message : "Could not cancel transcription.";
      setError(cancelMessage);

      // Cancel request failed — probe whether the job is still alive server-side.
      const probe = await probeJobAfterFailedCancel(() => getJob(SERVICE_URL, jobId));
      const recovery = resolveFailedCancelRecovery(probe);

      if (recovery === "reattach") {
        setBusy(true);
        try {
          await attachToJob(jobId, fileSignature);
        } catch {
          // Keep last-known job + busy so Cancel stays available.
          setBusy(true);
        }
      } else if (recovery === "sync-terminal" && probe.kind === "alive") {
        await applyJobUpdate(probe.job, fileSignature);
      } else if (recovery === "clear-local") {
        await clearJobSession();
        const next = await removeRecentJob(jobId);
        setRecentJobs(next);
        setSelectedRecentId("");
        setJob(null);
        setBusy(false);
        setCompletedSignature(null);
      } else {
        // Companion still unreachable: restore busy so Cancel remains available.
        setBusy(true);
      }
    } finally {
      setCancelling(false);
    }
  }

  async function handleStart() {
    const selectionError = validateSelectedAudioFiles(files);
    if (selectionError) {
      setError(selectionError);
      return;
    }

    setBusy(true);
    setError(null);
    setJob(null);
    stopWatching();

    try {
      const created = await createJob(SERVICE_URL, files, jobName);
      const activeSignature = getFileSignature(files);
      const name = jobName.trim() || defaultJobName(files[0].name);
      await saveJobSession({
        jobId: created.jobId,
        fileSignature: activeSignature,
        jobName: name,
      });
      setSelectedRecentId(created.jobId);
      const next = await upsertRecentJob({
        jobId: created.jobId,
        jobName: name,
        updatedAt: new Date().toISOString(),
        status: "queued",
      });
      setRecentJobs(next);
      await attachToJob(created.jobId, activeSignature);
    } catch (err) {
      setBusy(false);
      const fallback = err instanceof Error ? err.message : "Could not start transcription.";
      const kind = resolveUploadFailure(err);
      setError(describeUploadFailure(kind, fallback));
      // Mid-upload companion drop: surface unreachable + Retry so health matches reality.
      if (kind === "unreachable") {
        setHealth(null);
        setHealthReachError(fallback || "Could not reach Wispr Cloud.");
        if (unreachableSinceRef.current == null) {
          unreachableSinceRef.current = Date.now();
        }
      }
    }
  }

  async function handleRecentSelect(event: ChangeEvent<HTMLSelectElement>) {
    const jobId = event.target.value;
    setSelectedRecentId(jobId);
    if (!jobId) return;

    setError(null);
    stopWatching();

    try {
      const payload = await getJob(SERVICE_URL, jobId);
      setJobName(payload.jobName);
      setSelectedRecentId(payload.jobId);
      const next = await upsertRecentJob({
        jobId: payload.jobId,
        jobName: payload.jobName,
        updatedAt: payload.updatedAt,
        status: payload.status,
      });
      setRecentJobs(next);

      if (isTerminalJob(payload)) {
        setJob(payload);
        setBusy(false);
        if (payload.status === "done") setCompletedSignature(getFileSignature(files));
        clearJobSession();
        return;
      }

      await saveJobSession({
        jobId: payload.jobId,
        fileSignature: getFileSignature(files),
        jobName: payload.jobName,
      });
      await attachToJob(payload.jobId, getFileSignature(files));
    } catch (err) {
      setJob(null);
      setBusy(false);
      setError(err instanceof Error ? err.message : "Could not load that recent job.");
      setSelectedRecentId("");
      // Only drop the recent entry when the companion confirms the job is gone.
      // Network / companion-down failures must keep the list so the user can retry.
      if (resolveJobLoadRecovery(err) === "clear-local") {
        const next = await removeRecentJob(jobId);
        setRecentJobs(next);
        const session = await loadJobSession();
        if (session?.jobId === jobId) await clearJobSession();
      }
    }
  }

  async function attachToJob(jobId: string, fileSignature: string) {
    stopWatching();
    const generation = watchGenerationRef.current;

    const initialJob = await getJob(SERVICE_URL, jobId);
    if (watchGenerationRef.current !== generation) return;

    await applyJobUpdate(initialJob, fileSignature, generation);
    if (watchGenerationRef.current !== generation) return;
    if (isTerminalJob(initialJob)) return;

    setJobTransport(null);
    const watcher = createJobEventWatcher({
      url: eventsUrl(SERVICE_URL, jobId),
      onMessage: (data) => {
        if (watchGenerationRef.current !== generation) return;
        const payload = JSON.parse(data) as JobPayload;
        void applyJobUpdate(payload, fileSignature, generation);
      },
      onPoll: async () => {
        if (watchGenerationRef.current !== generation) return;
        try {
          const payload = await getJob(SERVICE_URL, jobId);
          if (watchGenerationRef.current !== generation) return;
          await applyJobUpdate(payload, fileSignature, generation);
        } catch (err) {
          if (watchGenerationRef.current !== generation) return;
          setError(err instanceof Error ? err.message : "Could not refresh job status.");
        }
      },
      onTransportChange: (transport) => {
        if (watchGenerationRef.current !== generation) return;
        setJobTransport(transport);
      },
    });
    watcherRef.current = watcher;
    setIsWatching(true);
  }

  async function applyJobUpdate(
    payload: JobPayload,
    fileSignature: string,
    generation = watchGenerationRef.current,
  ) {
    if (watchGenerationRef.current !== generation) return;

    setJob(payload);
    setBusy(payload.status === "queued" || payload.status === "running");
    setSelectedRecentId(payload.jobId);

    const next = await upsertRecentJob({
      jobId: payload.jobId,
      jobName: payload.jobName,
      updatedAt: payload.updatedAt,
      status: payload.status,
    });
    if (watchGenerationRef.current !== generation) return;
    setRecentJobs(next);

    if (payload.status === "done") {
      setCompletedSignature(fileSignature);
      stopWatching();
      clearJobSession();
    }

    if (payload.status === "error" || payload.status === "cancelled") {
      stopWatching();
      setBusy(false);
      if (payload.status === "cancelled") clearJobSession();
    }
  }

  const downloads = getVisibleDownloads(job?.artifacts ?? []);
  const companion = describeCompanionHealth(health, healthReachError);
  const healthState = healthDotState(companion.state);
  // Only the active watcher owns transport labels — avoids "Connecting…" after Cancel mid-reconnect.
  const transportLabel = describeJobTransport(jobTransport, { watching: isWatching && !cancelling });
  const currentFileSignature = getFileSignature(files);
  const transcriptionComplete = files.length > 0 && completedSignature === currentFileSignature;
  const transcribeDisabled = busy || transcriptionComplete;

  return (
    <main className="app">
      <header className="hero">
        <div className="brand-lockup">
          <img className="brand-lockup__icon" src="/logo-icon.png" alt="" />
          <img className="brand-lockup__text" src="/logo-text.png" alt="Wispr Transcribr" />
        </div>
        <button
          className={`health-dot health-dot--${healthState}`}
          type="button"
          onClick={() => refreshHealth()}
          title={companion.detail ? `${companion.title}: ${companion.detail}` : companion.title}
          aria-label={companion.detail ? `${companion.title}: ${companion.detail}` : companion.title}
        >
          <span aria-hidden="true" />
        </button>
      </header>

      {companion.detail && (
        <div className={`companion-status companion-status--${companion.state}`} role="status">
          <p>{companion.detail}</p>
          {companion.state === "unreachable" && (
            <button
              className="companion-status__retry"
              type="button"
              onClick={() => void refreshHealth()}
              disabled={healthRefreshing}
            >
              {healthRefreshing ? "Retrying…" : "Retry"}
            </button>
          )}
        </div>
      )}

      {retryToast && (
        <div className="toast toast--ok" role="status" aria-live="polite">
          {retryToast}
        </div>
      )}

      {recentJobs.length > 0 && (
        <section className="panel recent-panel">
          <label className="field">
            <span>Recent jobs</span>
            <select value={selectedRecentId} onChange={handleRecentSelect}>
              <option value="">Select a recent transcript…</option>
              {recentJobs.map((entry) => (
                <option key={entry.jobId} value={entry.jobId}>
                  {formatRecentLabel(entry)}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}

      <section className="dropzone">
        <label>
          <span>Choose audio files</span>
          <input
            type="file"
            accept={supportedAudioAcceptAttribute()}
            multiple
            onChange={handleFiles}
          />
        </label>
        <p>Wispr will compress, split, transcribe, and merge your files into a transcript.</p>
      </section>

      {files.length > 0 && (
        <section className="panel">
          <label className="field">
            <span>Transcript name</span>
            <input value={jobName} onChange={(event) => setJobName(event.target.value)} />
          </label>
          <div className="file-list">
            {files.map((file) => (
              <div className="file-row" key={`${file.name}-${file.size}`}>
                <span>{file.name}</span>
                <small>{formatBytes(file.size)}</small>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="action-row">
        <button
          className={`btn btn--primary btn--big${busy ? " btn--loading" : ""}`}
          type="button"
          onClick={handleStart}
          disabled={transcribeDisabled}
        >
          {busy && <span className="btn__spinner" aria-hidden="true" />}
          <span>
            {busy ? "Transcribing..." : transcriptionComplete ? "Transcript ready" : "Transcribe"}
          </span>
        </button>
        {busy && job && (
          <button
            className="btn btn--danger"
            type="button"
            onClick={() => void handleCancel()}
            disabled={cancelling}
          >
            {cancelling ? "Cancelling…" : "Cancel"}
          </button>
        )}
      </div>

      {error && <div className="alert">{error}</div>}

      {job && (
        <section className="panel progress-panel">
          <div className="progress-head">
            <strong>{job.stage}</strong>
            <span>{job.progress}%</span>
          </div>
          {transportLabel && (
            <p
              className={`link-status${jobTransport === "sse" ? "" : " link-status--pending"}`}
              role="status"
            >
              {transportLabel}
            </p>
          )}
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${job.progress}%` }} />
          </div>
          {job.error && <div className="alert">{job.error}</div>}
          <div className="logs">
            {job.logs.slice(-6).map((line) => (
              <code key={line}>{line}</code>
            ))}
          </div>
        </section>
      )}

      {downloads.length > 0 && job && (
        <section className="panel downloads-panel">
          <h2>Downloads</h2>
          <div className="download-list">
            {downloads.map((artifact) => (
              <a
                className={`download download--${artifact.kind}${isHeroTranscript(artifact.label) ? " download--hero" : ""}`}
                href={artifactUrl(SERVICE_URL, job.jobId, artifact.id)}
                key={artifact.id}
                target="_blank"
                title={`Download ${artifact.label}`}
              >
                <span>{artifact.label}</span>
                <span className="download__icon" aria-hidden="true">
                  <svg viewBox="0 0 20 20" focusable="false">
                    <path d="M10 2.5a.85.85 0 0 1 .85.85v7.18l2.43-2.43a.85.85 0 1 1 1.2 1.2l-3.88 3.88a.85.85 0 0 1-1.2 0L5.52 9.3a.85.85 0 1 1 1.2-1.2l2.43 2.43V3.35A.85.85 0 0 1 10 2.5Z" />
                    <path d="M4.75 13.85a.85.85 0 0 1 .85.85v.95h8.8v-.95a.85.85 0 1 1 1.7 0v1.8a.85.85 0 0 1-.85.85H4.75a.85.85 0 0 1-.85-.85v-1.8a.85.85 0 0 1 .85-.85Z" />
                  </svg>
                </span>
              </a>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function getVisibleDownloads(artifacts: JobPayload["artifacts"]): JobPayload["artifacts"] {
  return artifacts
    .filter((artifact) => {
      const label = artifact.label.toLowerCase();
      if (label.includes("_part-") || label.match(/_part-\d+\.txt$/)) return false;
      if (label.match(/_part-\d{3}\.mp3$/)) return false;
      return label.includes("full-transcript") || label.endsWith("_compressed.mp3");
    })
    .sort((a, b) => downloadRank(a.label) - downloadRank(b.label));
}

function downloadRank(label: string): number {
  const lower = label.toLowerCase();
  if (lower.includes("full-transcript") && lower.endsWith(".txt")) return 0;
  if (lower.includes("full-transcript") && lower.endsWith(".md")) return 1;
  if (lower.endsWith("_compressed.mp3")) return 2;
  return 3;
}

function isHeroTranscript(label: string): boolean {
  const lower = label.toLowerCase();
  return lower.includes("full-transcript") && (lower.endsWith(".txt") || lower.endsWith(".md"));
}

function formatRecentLabel(entry: RecentJob): string {
  const status = entry.status ? ` · ${entry.status}` : "";
  const when = formatRelativeTime(entry.updatedAt);
  return `${entry.jobName || entry.jobId.slice(0, 8)}${status}${when ? ` · ${when}` : ""}`;
}

function formatRelativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const deltaMs = Date.now() - then;
  const minutes = Math.round(deltaMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function getFileSignature(files: File[]): string {
  return files.map((file) => `${file.name}:${file.size}:${file.lastModified}`).join("|");
}

function isTerminalJob(job: JobPayload): boolean {
  return job.status === "done" || job.status === "error" || job.status === "cancelled";
}

function defaultJobName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

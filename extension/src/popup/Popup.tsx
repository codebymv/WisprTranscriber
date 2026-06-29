import { ChangeEvent, useEffect, useRef, useState } from "react";
import { artifactUrl, createJob, eventsUrl, getHealth, getJob } from "../api/client";
import { DEFAULT_SETTINGS, HealthPayload, JobPayload } from "../api/types";

const SERVICE_URL = DEFAULT_SETTINGS.serviceUrl;

export function Popup() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [jobName, setJobName] = useState("");
  const [job, setJob] = useState<JobPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedSignature, setCompletedSignature] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    refreshHealth();
    return () => eventSourceRef.current?.close();
  }, []);

  async function refreshHealth() {
    setError(null);
    try {
      const payload = await getHealth(SERVICE_URL);
      setHealth(payload);
    } catch (err) {
      setHealth(null);
      setError(err instanceof Error ? err.message : "Could not reach Wispr Cloud.");
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
  }

  async function handleStart() {
    if (files.length === 0) {
      setError("Choose at least one audio file first.");
      return;
    }

    setBusy(true);
    setError(null);
    setJob(null);
    eventSourceRef.current?.close();

    try {
      const created = await createJob(SERVICE_URL, files, jobName);
      const initialJob = await getJob(SERVICE_URL, created.jobId);
      setJob(initialJob);
      const source = new EventSource(eventsUrl(SERVICE_URL, created.jobId));
      eventSourceRef.current = source;
      const activeSignature = getFileSignature(files);
      source.onmessage = (event) => {
        const payload = JSON.parse(event.data) as JobPayload;
        setJob(payload);
        if (payload.status === "done") {
          setCompletedSignature(activeSignature);
          source.close();
          setBusy(false);
        }
        if (payload.status === "error") {
          source.close();
          setBusy(false);
        }
      };
      source.onerror = () => {
        source.close();
        setBusy(false);
      };
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Could not start transcription.");
    }
  }

  const downloads = job?.artifacts ?? [];
  const healthState = getHealthState(health);
  const healthTitle = getHealthTitle(health);
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
          title={healthTitle}
          aria-label={healthTitle}
        >
          <span aria-hidden="true" />
        </button>
      </header>

      <section className="dropzone">
        <label>
          <span>Choose audio files</span>
          <input
            type="file"
            accept=".mp3,.mp4,.mpeg,.mpga,.m4a,.wav,.webm,audio/*"
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

      <button className="btn btn--primary btn--big" type="button" onClick={handleStart} disabled={transcribeDisabled}>
        {busy ? "Transcribing..." : transcriptionComplete ? "Transcript ready" : "Transcribe"}
      </button>

      {error && <div className="alert">{error}</div>}

      {job && (
        <section className="panel progress-panel">
          <div className="progress-head">
            <strong>{job.stage}</strong>
            <span>{job.progress}%</span>
          </div>
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
                className={`download download--${artifact.kind}`}
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

function getFileSignature(files: File[]): string {
  return files.map((file) => `${file.name}:${file.size}:${file.lastModified}`).join("|");
}

function getHealthState(health: HealthPayload | null): "checking" | "ready" | "error" {
  if (!health) return "checking";
  return health.ok ? "ready" : "error";
}

function getHealthTitle(health: HealthPayload | null): string {
  if (!health) return "Checking Wispr Cloud";
  return `${health.ok ? "Wispr Cloud ready" : "Wispr Cloud needs attention"}: ${health.model} · ffmpeg ${
    health.ffmpegFound ? "found" : "missing"
  } · key ${health.hasApiKey ? "set" : "missing"}`;
}

function defaultJobName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

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
      source.onmessage = (event) => {
        const payload = JSON.parse(event.data) as JobPayload;
        setJob(payload);
        if (payload.status === "done" || payload.status === "error") {
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

  const transcripts = job?.artifacts.filter((artifact) => artifact.kind === "transcript") ?? [];
  const audioArtifacts = job?.artifacts.filter((artifact) => artifact.kind === "audio") ?? [];

  return (
    <main className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">Hosted audio transcription</p>
          <h1>Wispr Transcriber</h1>
        </div>
        <button className="btn btn--ghost" type="button" onClick={() => refreshHealth()}>
          Check
        </button>
      </header>

      <section className={`status ${health?.ok ? "status--ok" : "status--warn"}`}>
        <div>
          <strong>{health?.ok ? "Wispr Cloud ready" : "Wispr Cloud needs attention"}</strong>
          <span>
            {health
              ? `${health.model} · ffmpeg ${health.ffmpegFound ? "found" : "missing"} · key ${
                  health.hasApiKey ? "set" : "missing"
                }`
              : "Checking the hosted transcription service..."}
          </span>
        </div>
      </section>

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

      <button className="btn btn--primary btn--big" type="button" onClick={handleStart} disabled={busy}>
        {busy ? "Transcribing..." : "Transcribe"}
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

      {transcripts.length > 0 && job && (
        <section className="panel">
          <h2>Transcript downloads</h2>
          <div className="download-list">
            {transcripts.map((artifact) => (
              <a
                className="download"
                href={artifactUrl(SERVICE_URL, job.jobId, artifact.id)}
                key={artifact.id}
                target="_blank"
              >
                {artifact.label}
              </a>
            ))}
          </div>
        </section>
      )}

      {audioArtifacts.length > 0 && job && (
        <section className="panel">
          <h2>Compressed audio</h2>
          <div className="download-list">
            {audioArtifacts.map((artifact) => (
              <a
                className="download download--muted"
                href={artifactUrl(SERVICE_URL, job.jobId, artifact.id)}
                key={artifact.id}
                target="_blank"
              >
                {artifact.label}
              </a>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function defaultJobName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
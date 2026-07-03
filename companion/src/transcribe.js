import { readFile } from "node:fs/promises";
import path from "node:path";

export async function transcribeWithOpenAI(filePath, config) {
  if (config.mockTranscription) {
    return `Mock transcript for ${path.basename(filePath)}.`;
  }
  if (!config.apiKey) {
    throw new Error("OPENAI_API_KEY is not set in companion/.env.");
  }

  const audio = await readFile(filePath);
  const form = new FormData();
  form.append("model", config.model);
  form.append("response_format", "json");
  form.append("file", new Blob([audio]), path.basename(filePath));

  let response;
  try {
    response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: form,
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`OpenAI transcription request failed before a response: ${reason}`);
  }

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI transcription failed (${response.status}): ${body}`);
  }

  try {
    const parsed = JSON.parse(body);
    if (typeof parsed.text === "string") return parsed.text;
  } catch {
    if (body.trim()) return body.trim();
  }

  throw new Error("OpenAI transcription response did not include text.");
}

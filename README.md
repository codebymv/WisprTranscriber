# Wispr Transcribr

Wispr Transcribr is a local-first transcription workbench:

- The Chrome extension provides the lightweight upload/status/download UI.
- The local companion service owns `ffmpeg`, OpenAI API calls, retries, splitting, merging, and output files.
- Your OpenAI API key lives only in `companion/.env`.

## Quick Start

1. Install extension dependencies:

   ```powershell
   cd C:\Users\roxas\OneDrive\Desktop\PROJECTS\wispr-transcribr\extension
   npm install
   npm run build
   ```

2. Configure the companion:

   ```powershell
   cd C:\Users\roxas\OneDrive\Desktop\PROJECTS\wispr-transcribr\companion
   copy .env.example .env
   ```

3. Edit `companion\.env` and add `OPENAI_API_KEY`.

4. Start the companion:

   ```powershell
   npm start
   ```

5. Load `extension\dist` in Chrome as an unpacked extension.

## Notes

- Default model is `whisper-1` to match the existing manual workflow.
- Default compression is mono MP3, `16000 Hz`, `20 kbps`.
- Long compressed files are split into about 45 minute chunks before transcription.
- API usage uses OpenAI Platform billing/usage for the API key in `.env`.
- Output artifacts default to `companion\data` unless `WISPR_DATA_DIR` is set.

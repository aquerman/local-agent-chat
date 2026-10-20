# Voice: dictation and read-aloud (roadmap item 11)

BennyChat uses LibreChat's own speech features (the mic button in the composer, the speaker button
under each message) and points them at two local servers. Both run on the **CPU**, so the 12 GB GPU
stays with the LLM, and both listen on `127.0.0.1` only; the browser only ever talks to BennyChat.
On a phone, read-aloud works over Tailscale as is, but browsers allow the microphone only on
`https://` or `localhost`, so dictation from the phone needs BennyChat served over Tailscale HTTPS.

| Job | Server | Port (`.env`) | What it needs |
|---|---|---|---|
| Speech to text | whisper.cpp `whisper-server.exe` | `VOICE_STT_PORT`, default 8082 | the Windows release zip, a ggml model, ffmpeg |
| Text to speech | `packages/piper` (this repo) running Piper | `VOICE_TTS_PORT`, default 8083 (Piper itself on `PIPER_PORT`, 8084) | Python 3.12 venv with `piper-tts`, voice files, ffmpeg |

`bennychat.yaml` (section "Roadmap 11, voice") already has the `speech` config. If you change a
port in `.env`, change the URL and `allowedAddresses` entry there as well: the YAML cannot read
`.env`.

## Why these two

- **whisper.cpp** is the same project family as llama.cpp: one native Windows exe, no Python, and
  its server has a switch (`--inference-path /v1/audio/transcriptions`) that makes it answer in
  OpenAI's format, which LibreChat's `openai` STT provider speaks without any `customParams`. Whisper
  models are multilingual, and `-l auto` detects Dutch or English per recording. The alternative,
  Speaches / faster-whisper-server, is a large Python install (PyTorch, gradio, pyannote) that
  mainly targets Docker.
- **Piper** is small (one ~60 MB ONNX file per voice), fast on a CPU, and has **Dutch and English**
  voices. Kokoro (Kokoro-FastAPI) sounds better in English but has no Dutch voice and pulls in
  PyTorch. Piper's own HTTP server is not OpenAI-shaped and only returns WAV, while LibreChat sends
  OpenAI requests and plays the reply as an mp3 stream. `packages/piper` closes that gap: it starts
  Piper, accepts `POST /v1/audio/speech`, strips Markdown so `**` and links are not read out, and
  encodes mp3 with ffmpeg.
- **One voice for both languages:** Piper voices are per language, so the voice `auto` (the default)
  looks at each text and uses your installed `nl_*` voice for Dutch and the `en_*` voice for English.
  Picking a named voice in Settings > Speech forces that voice.

## Install (Windows, PowerShell, from the repo root)

Smart App Control must be off, as for llama.cpp: the whisper.cpp zip is unsigned.

1. **ffmpeg** (both servers use it): `winget install Gyan.FFmpeg`, then open a new terminal so it
   is on `PATH`. Check with `ffmpeg -version`.
2. **whisper-server** (CPU build) and a model:
   ```powershell
   mkdir bin\whisper
   gh release download --repo ggml-org/whisper.cpp -p whisper-bin-x64.zip -D $env:TEMP --clobber
   Expand-Archive $env:TEMP\whisper-bin-x64.zip $env:TEMP\whisper-bin -Force
   Copy-Item $env:TEMP\whisper-bin\Release\* bin\whisper\   # older zips have no Release folder: copy the top level
   curl.exe -L -o bin\whisper\ggml-small-q5_1.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin
   ```
   `bin\whisper\whisper-server.exe` must exist afterwards. `whisper-blas-bin-x64.zip` (OpenBLAS) is
   a faster CPU build if you want to try it; do not take a `cublas` build, that one uses the GPU.
   `ggml-small-q5_1.bin` (~190 MB) is the default: decent Dutch, about real time or better on a
   desktop CPU. `ggml-base.bin` (~150 MB) is faster but weaker in Dutch; `ggml-large-v3-turbo-q5_0.bin`
   (~550 MB) is clearly better in Dutch and several times slower. Set `VOICE_STT_MODEL` in `.env` to
   use another file.
3. **Piper** in its own venv, plus one Dutch and one English voice:
   ```powershell
   winget install Python.Python.3.12
   py -3.12 -m venv bin\piper
   bin\piper\Scripts\python -m pip install "piper-tts[http]==1.8.0"
   bin\piper\Scripts\python -m piper.download_voices --data-dir bin\piper\voices nl_NL-mls-medium en_US-lessac-medium
   ```
   `bin\piper\Scripts\python -m piper.download_voices` without names lists every voice; other
   Dutch ones include the Flemish `nl_BE-nathalie-medium` and `nl_BE-rdh-medium`. If you install
   other voices, list them in `speech.tts.openai.voices` in `bennychat.yaml` (keep `auto` first).
4. `npm run build` (builds `packages/piper` with the other workspaces).
5. Run `scripts\start-all.bat`. It now opens a **Whisper** and a **Piper** tab before LibreChat.
   Each is skipped when its server is not installed or its port already listens.
   `scripts\start-stt.bat` and `scripts\start-tts.bat` start one of them on its own.

Optional `.env` keys (all have defaults): `VOICE_STT_PORT`, `VOICE_STT_MODEL`, `VOICE_STT_THREADS`
(4), `VOICE_TTS_PORT`, `PIPER_PORT`, `PIPER_PYTHON` (`bin\piper\Scripts\python.exe`),
`PIPER_VOICES_DIR` (`bin\piper\voices`), `PIPER_DEFAULT_VOICE` (first voice found), `FFMPEG_PATH`
(`ffmpeg`).

## Using it

- **Dictation:** click the mic in the composer, speak, click it again. The text appears in the
  composer and you send it yourself, as in Claude. Settings > Speech can turn on auto-stop after
  3 s of silence ("Auto transcribe audio") or auto-send.
- **Read aloud:** the speaker button under a message. Automatic read-aloud of every reply is off;
  Settings > Speech > "Autoplay Latest Message" turns it on.
- These are defaults from `speech.speechTab`: once you change a setting in the browser, the
  browser's choice wins.

## Check the servers by hand

```powershell
curl.exe http://127.0.0.1:8083/v1/audio/voices
curl.exe -o test.mp3 -H "Content-Type: application/json" -d '{\"input\":\"Dit is een test.\",\"voice\":\"auto\"}' http://127.0.0.1:8083/v1/audio/speech
curl.exe -F file=@test.mp3 -F model=whisper-1 http://127.0.0.1:8082/v1/audio/transcriptions
```

A 403 or "blocked" error from LibreChat means the port is missing from `allowedAddresses` in
`bennychat.yaml` (the speech SSRF guard blocks loopback by default).

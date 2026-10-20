@echo off
rem Starts the read-aloud voice (roadmap item 11) on 127.0.0.1, CPU only: packages\piper, an
rem OpenAI-compatible /v1/audio/speech server that runs Piper as a child process.
rem   python:  bin\piper\Scripts\python.exe with piper-tts[http]   (git-ignored; setup in docs\voice.md)
rem   voices:  bin\piper\voices\*.onnx + *.onnx.json
rem   port:    VOICE_TTS_PORT from .env, default 8083 (must match speech.tts in bennychat.yaml);
rem            Piper itself listens on PIPER_PORT, default 8084
rem The server reads .env itself (PIPER_PYTHON, PIPER_VOICES_DIR, PIPER_DEFAULT_VOICE, FFMPEG_PATH).
rem scripts\start-all.bat opens this in its own tab; it can also be run on its own.

setlocal
for %%I in ("%~dp0..") do set "CHAT=%%~fI"
cd /d "%CHAT%"
if not exist "packages\piper\dist\index.cjs" (
  echo packages\piper is not built yet. Run: npm run build
  pause
  exit /b 1
)
where ffmpeg >nul 2>nul || (
  echo ffmpeg is not on PATH, so speech cannot be encoded as mp3. Run: winget install Gyan.FFmpeg
  pause
  exit /b 1
)

title Piper (read aloud)
node packages\piper\dist\index.cjs
pause

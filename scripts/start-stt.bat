@echo off
rem Starts whisper.cpp's whisper-server for dictation (roadmap item 11) on 127.0.0.1, CPU only.
rem   binary:  bin\whisper\whisper-server.exe and its DLLs   (git-ignored; setup in docs\voice.md)
rem   model:   VOICE_STT_MODEL from .env, default bin\whisper\ggml-small-q5_1.bin
rem   port:    VOICE_STT_PORT from .env, default 8082 (must match speech.stt in bennychat.yaml)
rem   threads: VOICE_STT_THREADS from .env, default 4
rem ffmpeg must be on PATH: --convert turns the browser's webm/ogg/mp4 recording into WAV.
rem scripts\start-all.bat opens this in its own tab; it can also be run on its own.

setlocal
for %%I in ("%~dp0..") do set "CHAT=%%~fI"
set "WHISPER_EXE=%CHAT%\bin\whisper\whisper-server.exe"
set "VOICE_STT_PORT=8082"
set "VOICE_STT_MODEL=bin\whisper\ggml-small-q5_1.bin"
set "VOICE_STT_THREADS=4"
if exist "%CHAT%\.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%CHAT%\.env") do (
    if /i "%%A"=="VOICE_STT_PORT" set "VOICE_STT_PORT=%%B"
    if /i "%%A"=="VOICE_STT_MODEL" set "VOICE_STT_MODEL=%%B"
    if /i "%%A"=="VOICE_STT_THREADS" set "VOICE_STT_THREADS=%%B"
  )
)

cd /d "%CHAT%"
if not exist "%WHISPER_EXE%" (
  echo whisper-server is not installed: %WHISPER_EXE% is missing. See docs\voice.md.
  pause
  exit /b 1
)
if not exist "%VOICE_STT_MODEL%" (
  echo Whisper model %VOICE_STT_MODEL% is missing. See docs\voice.md for the download.
  pause
  exit /b 1
)
where ffmpeg >nul 2>nul || (
  echo ffmpeg is not on PATH, so browser recordings cannot be converted. Run: winget install Gyan.FFmpeg
  pause
  exit /b 1
)

title Whisper (dictation)
"%WHISPER_EXE%" --host 127.0.0.1 --port %VOICE_STT_PORT% -m "%VOICE_STT_MODEL%" -l auto -t %VOICE_STT_THREADS% --convert --tmp-dir "%TEMP%" --inference-path /v1/audio/transcriptions
pause

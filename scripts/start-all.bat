@echo off
rem Starts everything needed for a chat session in one Windows Terminal window:
rem   tab "llama-server"  the model server from ..\local-llm, listening on 127.0.0.1:8080
rem   tab "Embeddings"    local-llm's embeddings server, only with EMBEDDINGS_PORT in .env
rem   tab "RAG API"       retrieval over uploaded files, only with RAG_API_URL in .env and ..\rag_api set up
rem   tab "Meilisearch"   chat search, 127.0.0.1:7700, only with SEARCH=true in .env and bin\meilisearch.exe
rem   tab "Whisper"       dictation (speech to text), 127.0.0.1:8082, only when bin\whisper\whisper-server.exe exists
rem   tab "Piper"         read aloud (text to speech), 127.0.0.1:8083, only when the bin\piper venv exists
rem   tab "LibreChat"     the LibreChat backend from this repo, listening on localhost:3080
rem MongoDB runs as a Windows service and needs no tab.
rem A tab is skipped when its port already has a listener, so re-running never starts a second copy.
rem Close a tab or press Ctrl+C in it to stop that server.
rem The Desktop "Start All" entry is a shortcut to this file. Paths are resolved from this file's folder
rem (%~dp0), so they do not depend on where the shortcut starts; local-llm sits next to this repo.

setlocal
for %%I in ("%~dp0..") do set "CHAT=%%~fI"
for %%I in ("%CHAT%\..\local-llm") do set "LLM=%%~fI"

where wt >nul 2>nul || (
  echo Windows Terminal ^(wt.exe^) is not installed. Install it from the Microsoft Store.
  pause
  exit /b 1
)

set "START_LLM=1"
set "START_MEILI="
set "START_CHAT=1"
netstat -ano | findstr /r /c:":8080 .*LISTENING" >nul && (
  echo llama-server is already listening on port 8080, not starting it again.
  set "START_LLM="
)
netstat -ano | findstr /r /c:":3080 .*LISTENING" >nul && (
  echo LibreChat is already listening on port 3080, not starting it again.
  set "START_CHAT="
)

rem Meilisearch (chat search) is optional: it starts only when .env has SEARCH=true and
rem bin\meilisearch.exe exists, so the launcher works the same without it.
set "SEARCH="
set "EMBEDDINGS_PORT="
set "RAG_API_URL="
set "RAG_PORT=8000"
if exist "%CHAT%\.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%CHAT%\.env") do (
    if /i "%%A"=="SEARCH" set "SEARCH=%%B"
    if /i "%%A"=="EMBEDDINGS_PORT" set "EMBEDDINGS_PORT=%%B"
    if /i "%%A"=="RAG_API_URL" set "RAG_API_URL=%%B"
    if /i "%%A"=="RAG_PORT" set "RAG_PORT=%%B"
  )
)
if /i "%SEARCH%"=="true" set "START_MEILI=1"
if defined START_MEILI if not exist "%CHAT%\bin\meilisearch.exe" (
  echo SEARCH=true in .env but bin\meilisearch.exe is missing, so chat search stays off.
  echo See CLAUDE.md, "Chat search", for the download step.
  set "START_MEILI="
)
if defined START_MEILI (
  netstat -ano | findstr /r /c:":7700 .*LISTENING" >nul && (
    echo Meilisearch is already listening on port 7700, not starting it again.
    set "START_MEILI="
  )
)

rem Retrieval over uploaded files (roadmap F4/R9) is optional as well. EMBEDDINGS_PORT in .env opens
rem local-llm's embeddings server; RAG_API_URL opens the RAG API, which scripts\setup-rag.ps1 installs
rem once into ..\rag_api. Each is skipped with a note when its part is missing.
set "START_EMBED="
set "START_RAG="
if defined EMBEDDINGS_PORT set "START_EMBED=1"
if defined RAG_API_URL set "START_RAG=1"
if defined START_EMBED if not exist "%LLM%\bin\llama-server.exe" (
  echo EMBEDDINGS_PORT is set but ..\local-llm\bin\llama-server.exe is missing, so embeddings stay off.
  set "START_EMBED="
)
if defined START_EMBED if not exist "%LLM%\scripts\start-embeddings.ps1" (
  echo EMBEDDINGS_PORT is set but local-llm has no scripts\start-embeddings.ps1 yet: pull local-llm.
  set "START_EMBED="
)
if defined START_EMBED (
  netstat -ano | findstr /r /c:":%EMBEDDINGS_PORT% .*LISTENING" >nul && (
    echo The embeddings server is already listening on port %EMBEDDINGS_PORT%, not starting it again.
    set "START_EMBED="
  )
)
if defined START_RAG if not exist "%CHAT%\..\rag_api\env\python.exe" (
  echo RAG_API_URL is set but the RAG API is not installed: run scripts\setup-rag.ps1 once.
  set "START_RAG="
)
if defined START_RAG (
  netstat -ano | findstr /r /c:":%RAG_PORT% .*LISTENING" >nul && (
    echo The RAG API is already listening on port %RAG_PORT%, not starting it again.
    set "START_RAG="
  )
)

rem Voice (roadmap 11, docs\voice.md) is optional: each tab starts only when its server is installed.
rem Ports come from .env (VOICE_STT_PORT / VOICE_TTS_PORT) and must match speech in bennychat.yaml.
set "START_STT="
set "START_TTS="
set "VOICE_STT_PORT=8082"
set "VOICE_TTS_PORT=8083"
set "PIPER_PYTHON=%CHAT%\bin\piper\Scripts\python.exe"
if exist "%CHAT%\.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%CHAT%\.env") do (
    if /i "%%A"=="VOICE_STT_PORT" set "VOICE_STT_PORT=%%B"
    if /i "%%A"=="VOICE_TTS_PORT" set "VOICE_TTS_PORT=%%B"
    if /i "%%A"=="PIPER_PYTHON" set "PIPER_PYTHON=%%B"
  )
)
if exist "%CHAT%\bin\whisper\whisper-server.exe" set "START_STT=1"
if exist "%PIPER_PYTHON%" set "START_TTS=1"
if not defined START_STT if not defined START_TTS (
  echo Voice servers are not installed, so the mic and read-aloud buttons will not work. See docs\voice.md.
)
if defined START_STT (
  netstat -ano | findstr /r /c:":%VOICE_STT_PORT% .*LISTENING" >nul && (
    echo Whisper is already listening on port %VOICE_STT_PORT%, not starting it again.
    set "START_STT="
  )
)
if defined START_TTS (
  netstat -ano | findstr /r /c:":%VOICE_TTS_PORT% .*LISTENING" >nul && (
    echo Piper is already listening on port %VOICE_TTS_PORT%, not starting it again.
    set "START_TTS="
  )
)

rem Each tab is appended as " ; new-tab ..."; the leading " ; " is cut before wt runs.
set "TABS="
if defined START_LLM set "TABS=%TABS% ; new-tab --title "llama-server" -d "%LLM%" powershell -NoProfile -ExecutionPolicy Bypass -NoExit -File "%LLM%\scripts\start-server.ps1""
if defined START_EMBED set "TABS=%TABS% ; new-tab --title "Embeddings" -d "%LLM%" powershell -NoProfile -ExecutionPolicy Bypass -NoExit -File "%LLM%\scripts\start-embeddings.ps1" -Port %EMBEDDINGS_PORT%"
if defined START_RAG set "TABS=%TABS% ; new-tab --title "RAG API" -d "%CHAT%" powershell -NoProfile -ExecutionPolicy Bypass -NoExit -File "%CHAT%\scripts\start-rag.ps1""
if defined START_MEILI set "TABS=%TABS% ; new-tab --title "Meilisearch" -d "%CHAT%" cmd /k "%CHAT%\scripts\start-meili.bat""
if defined START_STT set "TABS=%TABS% ; new-tab --title "Whisper" -d "%CHAT%" cmd /k "%CHAT%\scripts\start-stt.bat""
if defined START_TTS set "TABS=%TABS% ; new-tab --title "Piper" -d "%CHAT%" cmd /k "%CHAT%\scripts\start-tts.bat""
if defined START_CHAT set "TABS=%TABS% ; new-tab --title "LibreChat" -d "%CHAT%" cmd /k npm run backend"

if not defined TABS (
  echo Nothing to start. Open http://localhost:3080
  pause
  exit /b 0
)

wt -w new %TABS:~3%

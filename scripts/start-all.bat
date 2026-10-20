@echo off
rem Starts everything needed for a chat session in one Windows Terminal window:
rem   tab "llama-server"  the model server from ..\local-llm, listening on 127.0.0.1:8080
rem   tab "Meilisearch"   chat search, 127.0.0.1:7700, only with SEARCH=true in .env and bin\meilisearch.exe
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
if exist "%CHAT%\.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%CHAT%\.env") do (
    if /i "%%A"=="SEARCH" set "SEARCH=%%B"
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

rem Each tab is appended as " ; new-tab ..."; the leading " ; " is cut before wt runs.
set "TABS="
if defined START_LLM set "TABS=%TABS% ; new-tab --title "llama-server" -d "%LLM%" powershell -NoProfile -ExecutionPolicy Bypass -NoExit -File "%LLM%\scripts\start-server.ps1""
if defined START_MEILI set "TABS=%TABS% ; new-tab --title "Meilisearch" -d "%CHAT%" cmd /k "%CHAT%\scripts\start-meili.bat""
if defined START_CHAT set "TABS=%TABS% ; new-tab --title "LibreChat" -d "%CHAT%" cmd /k npm run backend"

if not defined TABS (
  echo Nothing to start. Open http://localhost:3080
  pause
  exit /b 0
)

wt -w new %TABS:~3%

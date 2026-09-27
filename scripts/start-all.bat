@echo off
rem Starts everything needed for a chat session in one Windows Terminal window:
rem   tab "llama-server"  the model server from ..\local-llm, listening on 127.0.0.1:8080
rem   tab "LibreChat"     the LibreChat backend from this repo, listening on localhost:3080
rem MongoDB runs as a Windows service and needs no tab.
rem A tab is skipped when its port already has a listener, so re-running never starts a second copy.
rem Close a tab or press Ctrl+C in it to stop that server.
rem The Desktop "Start All" entry is a shortcut to this file; the paths below are absolute on purpose.

setlocal
set "LLM=C:\Users\aquerman\Documents\GitHub\local-llm"
set "CHAT=C:\Users\aquerman\Documents\GitHub\local-agent-chat"

where wt >nul 2>nul || (
  echo Windows Terminal ^(wt.exe^) is not installed. Install it from the Microsoft Store.
  pause
  exit /b 1
)

set "START_LLM=1"
set "START_CHAT=1"
netstat -ano | findstr /r /c:":8080 .*LISTENING" >nul && (
  echo llama-server is already listening on port 8080, not starting it again.
  set "START_LLM="
)
netstat -ano | findstr /r /c:":3080 .*LISTENING" >nul && (
  echo LibreChat is already listening on port 3080, not starting it again.
  set "START_CHAT="
)

if not defined START_LLM if not defined START_CHAT (
  echo Nothing to start. Open http://localhost:3080
  pause
  exit /b 0
)

if defined START_LLM if defined START_CHAT (
  wt -w new new-tab --title "llama-server" -d "%LLM%" powershell -NoProfile -ExecutionPolicy Bypass -NoExit -File "%LLM%\scripts\start-server.ps1" ; new-tab --title "LibreChat" -d "%CHAT%" cmd /k npm run backend
  exit /b 0
)
if defined START_LLM wt -w new new-tab --title "llama-server" -d "%LLM%" powershell -NoProfile -ExecutionPolicy Bypass -NoExit -File "%LLM%\scripts\start-server.ps1"
if defined START_CHAT wt -w new new-tab --title "LibreChat" -d "%CHAT%" cmd /k npm run backend

@echo off
rem Starts Meilisearch for chat search (roadmap item 12) on 127.0.0.1:7700.
rem   binary:  bin\meilisearch.exe   (git-ignored; download steps in CLAUDE.md, "Chat search")
rem   data:    meili_data\           (git-ignored)
rem   key:     MEILI_MASTER_KEY from .env, never passed on the command line
rem scripts\start-all.bat opens this in its own tab; it can also be run on its own.

setlocal
for %%I in ("%~dp0..") do set "CHAT=%%~fI"
set "MEILI_EXE=%CHAT%\bin\meilisearch.exe"

if not exist "%MEILI_EXE%" (
  echo Meilisearch is not installed: %MEILI_EXE% is missing.
  echo Chat search stays off. See CLAUDE.md, "Chat search", for the download step.
  pause
  exit /b 1
)

set "MEILI_MASTER_KEY="
if exist "%CHAT%\.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%CHAT%\.env") do (
    if /i "%%A"=="MEILI_MASTER_KEY" set "MEILI_MASTER_KEY=%%B"
  )
)
if not defined MEILI_MASTER_KEY (
  echo MEILI_MASTER_KEY is empty in .env. Generate one with:
  echo   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  echo and put it in .env as MEILI_MASTER_KEY=^<that value^>.
  pause
  exit /b 1
)

set "MEILI_NO_ANALYTICS=true"
title Meilisearch
cd /d "%CHAT%"
"%MEILI_EXE%" --http-addr 127.0.0.1:7700 --db-path "%CHAT%\meili_data" --env development
pause

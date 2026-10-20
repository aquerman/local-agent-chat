# One-time setup of LibreChat's RAG API (github.com/danny-avila/rag_api) for retrieval over uploaded
# files, without Docker. Run it again any time: every step is skipped when its result already exists.
#
# What it builds (nothing is installed system-wide, and nothing needs admin rights):
#   ..\rag_api              the RAG API source, pinned to the commit this fork was tested with
#   ..\rag_api\env          a conda-forge environment: Python 3.12, PostgreSQL 16 and pgvector
#                           (conda-forge is the only source of a prebuilt pgvector for Windows)
#   %LOCALAPPDATA%\bennychat\rag\pgdata   the vector database, listening on 127.0.0.1 only
#
# Needs: git, and Miniforge (winget install CondaForge.Miniforge3), and .env in this repo with the
# RAG block from .env.example filled in. start-rag.ps1 then runs it; start-all.bat opens it as a tab.
#
# Usage:  .\scripts\setup-rag.ps1 [-RagDir <path>] [-Conda <path to conda.exe>]

param(
  [string]$RagDir = (Join-Path $PSScriptRoot "..\..\rag_api"),
  [string]$Conda = ""
)

$ErrorActionPreference = "Stop"
$RagRepo = "https://github.com/danny-avila/rag_api.git"
$RagCommit = "c4e5cbf79fcece1df9adfff5dfed983a5990ca9f"
. (Join-Path $PSScriptRoot "rag-env.ps1")

$settings = Read-RagSettings (Join-Path $PSScriptRoot "..\.env")
$RagDir = [System.IO.Path]::GetFullPath($RagDir)
$envDir = Join-Path $RagDir "env"

function Find-Conda {
  if ($Conda) { return $Conda }
  $onPath = Get-Command conda.exe -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  $candidates = @(
    (Join-Path $env:USERPROFILE "miniforge3\Scripts\conda.exe"),
    (Join-Path $env:LOCALAPPDATA "miniforge3\Scripts\conda.exe"),
    (Join-Path $env:ProgramData "miniforge3\Scripts\conda.exe")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return $candidate }
  }
  throw "conda.exe not found. Install Miniforge (winget install CondaForge.Miniforge3) or pass -Conda."
}

if (-not (Test-Path (Join-Path $RagDir ".git"))) {
  Write-Host "Cloning the RAG API into $RagDir"
  git clone $RagRepo $RagDir
}
git -C $RagDir fetch --quiet origin
git -C $RagDir checkout --quiet $RagCommit

if (-not (Test-Path (Join-Path $envDir "python.exe"))) {
  $condaExe = Find-Conda
  Write-Host "Creating the conda environment in $envDir (Python, PostgreSQL, pgvector)"
  & $condaExe create --yes --prefix $envDir --channel conda-forge --override-channels `
    "python=3.12" "postgresql=16" "pgvector"
  if ($LASTEXITCODE -ne 0) { throw "conda create failed." }
}

$python = Join-Path $envDir "python.exe"
Write-Host "Installing the RAG API's Python packages (lite set: no local sentence-transformers)"
& $python -m pip install --disable-pip-version-check -r (Join-Path $RagDir "requirements.lite.txt")
if ($LASTEXITCODE -ne 0) { throw "pip install failed." }

$pgBin = Join-Path $envDir "Library\bin"
$pgData = Get-RagPgData
if (-not (Test-Path (Join-Path $pgData "PG_VERSION"))) {
  Write-Host "Creating the database cluster in $pgData"
  New-Item -ItemType Directory -Force -Path $pgData | Out-Null
  $pwFile = New-TemporaryFile
  try {
    Set-Content -Path $pwFile -Value $settings.POSTGRES_PASSWORD -NoNewline -Encoding ascii
    & (Join-Path $pgBin "initdb.exe") -D $pgData -U $settings.POSTGRES_USER `
      --pwfile="$($pwFile.FullName)" --auth=scram-sha-256 --encoding=UTF8
    if ($LASTEXITCODE -ne 0) { throw "initdb failed." }
  } finally {
    Remove-Item $pwFile -Force
  }
}

Start-RagPostgres -PgBin $pgBin -PgData $pgData -Port $settings.DB_PORT
$env:PGPASSWORD = $settings.POSTGRES_PASSWORD
$psql = Join-Path $pgBin "psql.exe"
$exists = & $psql -h 127.0.0.1 -p $settings.DB_PORT -U $settings.POSTGRES_USER -d postgres -tAc `
  "SELECT 1 FROM pg_database WHERE datname = '$($settings.POSTGRES_DB)'"
if ("$exists".Trim() -ne "1") {
  & (Join-Path $pgBin "createdb.exe") -h 127.0.0.1 -p $settings.DB_PORT -U $settings.POSTGRES_USER $settings.POSTGRES_DB
  if ($LASTEXITCODE -ne 0) { throw "createdb failed." }
}
& $psql -h 127.0.0.1 -p $settings.DB_PORT -U $settings.POSTGRES_USER -d $settings.POSTGRES_DB -c "CREATE EXTENSION IF NOT EXISTS vector"
if ($LASTEXITCODE -ne 0) { throw "pgvector could not be enabled." }

Write-Host ""
Write-Host "RAG API ready. Start it with scripts\start-rag.ps1, or scripts\start-all.bat (tab ""RAG API"")."
Write-Host "PostgreSQL keeps running in the background; stop it with:"
Write-Host "  & ""$pgBin\pg_ctl.exe"" stop -D ""$pgData"""

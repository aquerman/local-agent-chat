# Runs LibreChat's RAG API with its PostgreSQL + pgvector database, both set up by setup-rag.ps1.
# Embeddings come from local-llm's embeddings server (..\local-llm\scripts\start-embeddings.ps1),
# which start-all.bat opens in its own tab. Settings are read from this repo's .env (RAG block).
#
# PostgreSQL is started in the background if it is not already listening, and stopped again when
# this script ends (Ctrl+C or closing the tab), unless it was already running before.
#
# Usage:  .\scripts\start-rag.ps1 [-RagDir <path>]

param(
  [string]$RagDir = (Join-Path $PSScriptRoot "..\..\rag_api")
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "rag-env.ps1")

$RagDir = [System.IO.Path]::GetFullPath($RagDir)
$python = Join-Path $RagDir "env\python.exe"
$pgBin = Join-Path $RagDir "env\Library\bin"
$pgData = Get-RagPgData
if (-not (Test-Path $python) -or -not (Test-Path (Join-Path $pgData "PG_VERSION"))) {
  Write-Error "The RAG API is not set up yet. Run scripts\setup-rag.ps1 once (see CLAUDE.md, ""Knowledge and RAG"")."
  exit 1
}

$settings = Read-RagSettings (Join-Path $PSScriptRoot "..\.env")
foreach ($key in $settings.Keys) {
  [System.Environment]::SetEnvironmentVariable($key, $settings[$key], "Process")
}

$embeddings = $settings["RAG_OPENAI_BASEURL"]
if ($embeddings -and $settings["EMBEDDINGS_PORT"] -and -not (Test-PortListening ([int]$settings["EMBEDDINGS_PORT"]))) {
  Write-Warning "Nothing listens on the embeddings port $($settings["EMBEDDINGS_PORT"]) yet ($embeddings). Uploads for File Search fail until the Embeddings tab is up."
}

$ownsPostgres = -not (Test-PortListening ([int]$settings.DB_PORT))
Start-RagPostgres -PgBin $pgBin -PgData $pgData -Port $settings.DB_PORT
try {
  Set-Location $RagDir
  & $python main.py
} finally {
  if ($ownsPostgres) {
    & (Join-Path $pgBin "pg_ctl.exe") stop -D $pgData -m fast | Out-Null
  }
}

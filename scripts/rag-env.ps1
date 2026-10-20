# Shared by setup-rag.ps1 and start-rag.ps1 (dot-sourced, not run on its own).

# Reads KEY=VALUE lines from LibreChat's .env. The RAG API reads the same file, as upstream's
# docker-compose does with `env_file: .env`, so its keys (RAG_PORT, DB_PORT, EMBEDDINGS_*, ...) and
# JWT_SECRET, which both sides must share, live in one place.
function Read-DotEnv([string]$Path) {
  $values = @{}
  if (-not (Test-Path $Path)) { throw ".env not found at $Path. Copy .env.example to .env first." }
  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }
    $eq = $trimmed.IndexOf("=")
    if ($eq -lt 1) { continue }
    $key = $trimmed.Substring(0, $eq).Trim()
    $value = $trimmed.Substring($eq + 1).Trim()
    if ($value.Length -ge 2 -and ($value[0] -eq '"' -or $value[0] -eq "'") -and $value[-1] -eq $value[0]) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $values[$key] = $value
  }
  return $values
}

# The .env values with the RAG defaults this fork documents in .env.example filled in.
function Read-RagSettings([string]$Path) {
  $values = Read-DotEnv $Path
  $defaults = @{
    RAG_HOST = "127.0.0.1"; RAG_PORT = "8000"
    DB_HOST = "127.0.0.1"; DB_PORT = "5433"
    POSTGRES_DB = "bennychat_rag"; POSTGRES_USER = "bennychat"; POSTGRES_PASSWORD = "bennychat"
  }
  foreach ($key in $defaults.Keys) {
    if (-not $values.ContainsKey($key) -or $values[$key] -eq "") { $values[$key] = $defaults[$key] }
  }
  return $values
}

function Get-RagPgData {
  return Join-Path $env:LOCALAPPDATA "bennychat\rag\pgdata"
}

function Test-PortListening([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $client.Connect("127.0.0.1", $Port)
    return $true
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

# Starts PostgreSQL in the background on 127.0.0.1 only, unless something already listens there.
function Start-RagPostgres([string]$PgBin, [string]$PgData, [string]$Port) {
  if (Test-PortListening ([int]$Port)) { return }
  $log = Join-Path (Split-Path $PgData -Parent) "postgres.log"
  & (Join-Path $PgBin "pg_ctl.exe") start -D $PgData -l $log -w `
    -o "-p $Port -c listen_addresses=127.0.0.1"
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL did not start. See $log." }
}

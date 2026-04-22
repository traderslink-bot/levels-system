param(
  [switch]$DisableDiagnostics,
  [switch]$DoNotOpenBrowser
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$runtimeUrl = "http://127.0.0.1:3010/"
$sessionStamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$sessionDirectory = Join-Path $repoRoot ("artifacts\long-run\" + $sessionStamp)
$fullLogPath = Join-Path $sessionDirectory "manual-watchlist-full.log"
$operationalLogPath = Join-Path $sessionDirectory "manual-watchlist-operational.log"
$filteredLogPath = Join-Path $sessionDirectory "manual-watchlist-filtered.log"
$diagnosticLogPath = Join-Path $sessionDirectory "manual-watchlist-diagnostics.log"
$discordAuditPath = Join-Path $sessionDirectory "discord-delivery-audit.jsonl"
$sessionSummaryPath = Join-Path $sessionDirectory "session-summary.json"
$sessionInfoPath = Join-Path $sessionDirectory "session-info.txt"
$operationalPattern =
  "Manual watchlist server running|" +
  "Candle provider path|" +
  "Monitoring event diagnostics enabled|" +
  "Background activation failed|" +
  "Activation failed|" +
  "Failed to seed levels|" +
  "Failed to restore active symbol|" +
  "Historical candles unavailable|" +
  "IBKR error|" +
  "manual_watchlist_lifecycle|" +
  "discord_delivery_audit|" +
  "level_runtime_compare"
$diagnosticPattern = "monitoring_event_diagnostic"

$summary = [ordered]@{
  sessionDirectory = $sessionDirectory
  startedAt = $null
  endedAt = $null
  diagnosticsEnabled = $false
  activeSymbolCount = 0
  lifecycleCounts = @{}
  discordAudit = @{
    posted = 0
    failed = 0
    byOperation = @{}
  }
  failures = @{
    activation = 0
    restore = 0
    seed = 0
    ibkr = 0
  }
  compareEntries = 0
  diagnosticEntries = 0
}

function Write-SessionInfo {
  param(
    [string]$Line
  )

  Add-Content -LiteralPath $sessionInfoPath -Value $Line
}

function Save-SessionSummary {
  Set-Content -LiteralPath $sessionSummaryPath -Value ($summary | ConvertTo-Json -Depth 8)
}

function Increment-SummaryCount {
  param(
    [hashtable]$Table,
    [string]$Key
  )

  if (-not $Table.ContainsKey($Key)) {
    $Table[$Key] = 0
  }

  $Table[$Key] += 1
}

function Update-SummaryFromLine {
  param(
    [string]$Line
  )

  if ($Line -match "Background activation failed|Activation failed") {
    $summary.failures.activation += 1
  }

  if ($Line -match "Failed to restore active symbol") {
    $summary.failures.restore += 1
  }

  if ($Line -match "Failed to seed levels|Historical candles unavailable") {
    $summary.failures.seed += 1
  }

  if ($Line -match "IBKR error") {
    $summary.failures.ibkr += 1
  }

  if ($Line -match "level_runtime_compare") {
    $summary.compareEntries += 1
  }

  if ($Line -match $diagnosticPattern) {
    $summary.diagnosticEntries += 1
  }

  if (-not $Line.TrimStart().StartsWith("{")) {
    return
  }

  try {
    $parsed = $Line | ConvertFrom-Json -ErrorAction Stop
  } catch {
    return
  }

  if ($parsed.type -eq "manual_watchlist_lifecycle") {
    Increment-SummaryCount -Table $summary.lifecycleCounts -Key $parsed.event

    if ($parsed.event -eq "monitor_restart_completed" -and $parsed.details.activeSymbolCount -ne $null) {
      $summary.activeSymbolCount = [int]$parsed.details.activeSymbolCount
    }

    return
  }

  if ($parsed.type -eq "discord_delivery_audit") {
    if ($parsed.status -eq "posted") {
      $summary.discordAudit.posted += 1
    } elseif ($parsed.status -eq "failed") {
      $summary.discordAudit.failed += 1
    }

    if ($parsed.operation) {
      Increment-SummaryCount -Table $summary.discordAudit.byOperation -Key ([string]$parsed.operation)
    }
  }
}

function Write-RuntimeLine {
  param(
    [string]$Line
  )

  Add-Content -LiteralPath $fullLogPath -Value $Line
  Update-SummaryFromLine -Line $Line

  if ($Line -match $diagnosticPattern) {
    Add-Content -LiteralPath $diagnosticLogPath -Value $Line
  }

  if ($Line -match $operationalPattern) {
    Add-Content -LiteralPath $operationalLogPath -Value $Line
    Add-Content -LiteralPath $filteredLogPath -Value $Line
    Write-Host $Line
  }

  Save-SessionSummary
}

function Stop-ExistingManualRuntime {
  $listener = Get-NetTCPConnection -LocalPort 3010 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $listener) {
    return
  }

  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
  $commandLine = $process.CommandLine
  $looksLikeManualRuntime =
    $commandLine -match "manual-watchlist-server\.ts" -or
    $commandLine -match "watchlist:manual"

  if (-not $looksLikeManualRuntime) {
    throw "Port 3010 is already in use by PID $($listener.OwningProcess). Stop that process manually before starting the long-run launcher."
  }

  Stop-Process -Id $listener.OwningProcess -Force
  Start-Sleep -Seconds 2
}

New-Item -ItemType Directory -Path $sessionDirectory -Force | Out-Null
New-Item -ItemType File -Path $fullLogPath -Force | Out-Null
New-Item -ItemType File -Path $operationalLogPath -Force | Out-Null
New-Item -ItemType File -Path $filteredLogPath -Force | Out-Null
New-Item -ItemType File -Path $diagnosticLogPath -Force | Out-Null

"Levels System long-run session" | Set-Content -LiteralPath $sessionInfoPath
Write-SessionInfo "started_at=$(Get-Date -Format o)"
Write-SessionInfo "session_directory=$sessionDirectory"
Write-SessionInfo "full_log=$fullLogPath"
Write-SessionInfo "operational_log=$operationalLogPath"
Write-SessionInfo "filtered_log=$filteredLogPath"
Write-SessionInfo "diagnostic_log=$diagnosticLogPath"
Write-SessionInfo "discord_audit_log=$discordAuditPath"
Write-SessionInfo "session_summary=$sessionSummaryPath"
Write-SessionInfo "runtime_url=$runtimeUrl"

Write-Host "Long-run session directory: $sessionDirectory"
Write-Host "Full log: $fullLogPath"
Write-Host "Operational log: $operationalLogPath"
Write-Host "Diagnostic log: $diagnosticLogPath"

$summary.startedAt = Get-Date -Format o
Save-SessionSummary

try {
  Stop-ExistingManualRuntime
} catch {
  Write-Error $_
  exit 1
}

if ($DisableDiagnostics) {
  Remove-Item Env:LEVEL_MONITORING_EVENT_DIAGNOSTICS -ErrorAction SilentlyContinue
  Write-SessionInfo "diagnostics=off"
  $summary.diagnosticsEnabled = $false
} else {
  $env:LEVEL_MONITORING_EVENT_DIAGNOSTICS = "1"
  Write-SessionInfo "diagnostics=on"
  $summary.diagnosticsEnabled = $true
}

$env:LEVEL_MANUAL_SESSION_DIRECTORY = $sessionDirectory
Save-SessionSummary

if (-not $DoNotOpenBrowser) {
  Start-Job -ScriptBlock {
    param($Url)
    Start-Sleep -Seconds 8
    Start-Process $Url
  } -ArgumentList $runtimeUrl | Out-Null
}

Push-Location $repoRoot
try {
  & npm run watchlist:manual 2>&1 |
    ForEach-Object {
      $line = $_.ToString()
      Write-RuntimeLine $line
    }
} finally {
  Pop-Location
  Write-SessionInfo "ended_at=$(Get-Date -Format o)"
  $summary.endedAt = Get-Date -Format o
  Save-SessionSummary
}

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
$threadSummaryPath = Join-Path $sessionDirectory "thread-summaries.json"
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
  "opportunity_snapshot|" +
  "evaluation_update|" +
  "level_runtime_compare"
$diagnosticPattern = "monitoring_event_diagnostic"

$summary = [ordered]@{
  sessionDirectory = $sessionDirectory
  startedAt = $null
  endedAt = $null
  diagnosticsEnabled = $false
  activeSymbolCount = 0
  lifecycleCounts = @{}
  alerting = @{
    posted = 0
    suppressed = 0
    postedByEventType = @{}
    postedByFamily = @{}
    suppressedByReason = @{}
    suppressedByFamily = @{}
    noisiestFamilies = @()
  }
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
  opportunitySnapshots = 0
  evaluationUpdates = 0
  perSymbol = @{}
}

function Write-SessionInfo {
  param(
    [string]$Line
  )

  Add-Content -LiteralPath $sessionInfoPath -Value $Line
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

function Ensure-SymbolSummary {
  param(
    [string]$Symbol
  )

  if ([string]::IsNullOrWhiteSpace($Symbol)) {
    return $null
  }

  $normalized = $Symbol.Trim().ToUpperInvariant()
  if (-not $summary.perSymbol.ContainsKey($normalized)) {
    $summary.perSymbol[$normalized] = @{
      lifecycleCounts = @{}
      discordPosted = 0
      discordFailed = 0
      alertPosted = 0
      alertSuppressed = 0
      alertPostedByEventType = @{}
      alertPostedByFamily = @{}
      alertSuppressedByReason = @{}
      alertSuppressedByFamily = @{}
      snapshotPosts = 0
      extensionPosts = 0
      compareEntries = 0
      diagnosticEntries = 0
      opportunitySnapshots = 0
      evaluationUpdates = 0
      lastLifecycleEvent = $null
      lastAlert = $null
      lastSnapshot = $null
      lastExtension = $null
      failures = @{
        activation = 0
        restore = 0
        seed = 0
        ibkr = 0
      }
    }
  }

  return $summary.perSymbol[$normalized]
}

function Get-TopSummaryKeys {
  param(
    [hashtable]$Table,
    [int]$Top = 3
  )

  if (-not $Table -or $Table.Count -eq 0) {
    return @()
  }

  return @(
    $Table.GetEnumerator() |
      Where-Object { $_.Value -gt 0 } |
      Sort-Object -Property @{ Expression = "Value"; Descending = $true }, @{ Expression = "Key"; Descending = $false } |
      Select-Object -First $Top |
      ForEach-Object { "$($_.Key) x$($_.Value)" }
  )
}

function Merge-CountTables {
  param(
    [hashtable]$Primary,
    [hashtable]$Secondary
  )

  $merged = @{}
  foreach ($table in @($Primary, $Secondary)) {
    if (-not $table) {
      continue
    }

    foreach ($entry in $table.GetEnumerator()) {
      if (-not $merged.ContainsKey($entry.Key)) {
        $merged[$entry.Key] = 0
      }

      $merged[$entry.Key] += [int]$entry.Value
    }
  }

  return $merged
}

function Build-ThreadSummaryRecord {
  param(
    [string]$Symbol,
    [hashtable]$SymbolSummary
  )

  $status =
    if ($SymbolSummary.lastLifecycleEvent -eq "deactivated") {
      "inactive"
    } elseif ($SymbolSummary.lastLifecycleEvent -eq "activation_failed" -or $SymbolSummary.lastLifecycleEvent -eq "restore_failed") {
      "error"
    } elseif ($SymbolSummary.lastLifecycleEvent) {
      "active"
    } else {
      "unknown"
    }

  $headlineParts = @(
    "$Symbol is $status",
    "snapshots=$($SymbolSummary.snapshotPosts)",
    "alerts=$($SymbolSummary.alertPosted)"
  )

  if ($SymbolSummary.alertSuppressed -gt 0) {
    $headlineParts += "suppressed=$($SymbolSummary.alertSuppressed)"
  }

  $failureTotal =
    [int]$SymbolSummary.failures.activation +
    [int]$SymbolSummary.failures.restore +
    [int]$SymbolSummary.failures.seed +
    [int]$SymbolSummary.failures.ibkr
  if ($failureTotal -gt 0) {
    $headlineParts += "failures=$failureTotal"
  }

  $latestAlertSummary = $null
  if ($SymbolSummary.lastAlert) {
    $latestAlertSummary = @(
      [string]$SymbolSummary.lastAlert.eventType,
      [string]$SymbolSummary.lastAlert.severity,
      [string]$SymbolSummary.lastAlert.confidence
    )
    if ($SymbolSummary.lastAlert.score -ne $null) {
      $latestAlertSummary += ("score=" + ([double]$SymbolSummary.lastAlert.score).ToString("0.00"))
    }
    $latestAlertSummary = $latestAlertSummary | Where-Object { $_ }
  }

  return [ordered]@{
    symbol = $Symbol
    status = $status
    headline = ($headlineParts -join " | ")
    topPostedFamilies = Get-TopSummaryKeys -Table $SymbolSummary.alertPostedByFamily
    topSuppressionReasons = Get-TopSummaryKeys -Table $SymbolSummary.alertSuppressedByReason
    lifecycleHighlights = Get-TopSummaryKeys -Table $SymbolSummary.lifecycleCounts
    latestAlert = $SymbolSummary.lastAlert
    latestAlertSummary = if ($latestAlertSummary) { $latestAlertSummary -join " | " } else { $null }
    lastSnapshot = $SymbolSummary.lastSnapshot
    lastExtension = $SymbolSummary.lastExtension
    discordPosted = $SymbolSummary.discordPosted
    discordFailed = $SymbolSummary.discordFailed
    failures = $SymbolSummary.failures
  }
}

function Build-ThreadSummaries {
  $records = @()

  foreach ($symbol in ($summary.perSymbol.Keys | Sort-Object)) {
    $records += (Build-ThreadSummaryRecord -Symbol $symbol -SymbolSummary $summary.perSymbol[$symbol])
  }

  return $records
}

function Resolve-SymbolFromLine {
  param(
    [string]$Line
  )

  if (-not $Line) {
    return $null
  }

  if ($Line.TrimStart().StartsWith("{")) {
    try {
      $parsed = $Line | ConvertFrom-Json -ErrorAction Stop
      if ($parsed.symbol) {
        return [string]$parsed.symbol
      }
    } catch {
    }
  }

  $symbolMatch = [regex]::Match($Line, "\bfor\s+([A-Z]{1,10})\b")
  if ($symbolMatch.Success) {
    return $symbolMatch.Groups[1].Value
  }

  $compareMatch = [regex]::Match($Line, '"symbol"\s*:\s*"([A-Z]{1,10})"')
  if ($compareMatch.Success) {
    return $compareMatch.Groups[1].Value
  }

  return $null
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

  $lineSymbol = Resolve-SymbolFromLine -Line $Line
  $symbolSummary = Ensure-SymbolSummary -Symbol $lineSymbol
  if ($symbolSummary -ne $null) {
    if ($Line -match "Background activation failed|Activation failed") {
      $symbolSummary.failures.activation += 1
    }

    if ($Line -match "Failed to restore active symbol") {
      $symbolSummary.failures.restore += 1
    }

    if ($Line -match "Failed to seed levels|Historical candles unavailable") {
      $symbolSummary.failures.seed += 1
    }

    if ($Line -match "IBKR error") {
      $symbolSummary.failures.ibkr += 1
    }

    if ($Line -match "level_runtime_compare") {
      $symbolSummary.compareEntries += 1
    }

    if ($Line -match $diagnosticPattern) {
      $symbolSummary.diagnosticEntries += 1
    }
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
    $lifecycleSymbolSummary = Ensure-SymbolSummary -Symbol ([string]$parsed.symbol)
    if ($lifecycleSymbolSummary -ne $null) {
      Increment-SummaryCount -Table $lifecycleSymbolSummary.lifecycleCounts -Key ([string]$parsed.event)
      $lifecycleSymbolSummary.lastLifecycleEvent = [string]$parsed.event
    }

    if ($parsed.event -eq "snapshot_posted") {
      if ($lifecycleSymbolSummary -ne $null) {
        $lifecycleSymbolSummary.snapshotPosts += 1
        $lifecycleSymbolSummary.lastSnapshot = @{
          timestamp = $parsed.timestamp
          currentPrice = $parsed.details.currentPrice
          supportCount = $parsed.details.supportCount
          resistanceCount = $parsed.details.resistanceCount
        }
      }
    }

    if ($parsed.event -eq "extension_posted") {
      if ($lifecycleSymbolSummary -ne $null) {
        $lifecycleSymbolSummary.extensionPosts += 1
        $lifecycleSymbolSummary.lastExtension = @{
          timestamp = $parsed.timestamp
          side = $parsed.details.side
          levelCount = $parsed.details.levelCount
        }
      }
    }

    if ($parsed.event -eq "alert_posted") {
      $summary.alerting.posted += 1
      if ($parsed.details.eventType) {
        Increment-SummaryCount -Table $summary.alerting.postedByEventType -Key ([string]$parsed.details.eventType)
      }
      if ($parsed.details.family) {
        Increment-SummaryCount -Table $summary.alerting.postedByFamily -Key ([string]$parsed.details.family)
      }

      if ($lifecycleSymbolSummary -ne $null) {
        $lifecycleSymbolSummary.alertPosted += 1
        if ($parsed.details.eventType) {
          Increment-SummaryCount -Table $lifecycleSymbolSummary.alertPostedByEventType -Key ([string]$parsed.details.eventType)
        }
        if ($parsed.details.family) {
          Increment-SummaryCount -Table $lifecycleSymbolSummary.alertPostedByFamily -Key ([string]$parsed.details.family)
        }
        $lifecycleSymbolSummary.lastAlert = @{
          timestamp = $parsed.timestamp
          eventType = $parsed.details.eventType
          severity = $parsed.details.severity
          confidence = $parsed.details.confidence
          score = $parsed.details.score
          family = $parsed.details.family
          reason = $parsed.details.reason
        }
      }
    }

    if ($parsed.event -eq "alert_suppressed") {
      $summary.alerting.suppressed += 1
      if ($parsed.details.reason) {
        Increment-SummaryCount -Table $summary.alerting.suppressedByReason -Key ([string]$parsed.details.reason)
      }
      if ($parsed.details.family) {
        Increment-SummaryCount -Table $summary.alerting.suppressedByFamily -Key ([string]$parsed.details.family)
      }

      if ($lifecycleSymbolSummary -ne $null) {
        $lifecycleSymbolSummary.alertSuppressed += 1
        if ($parsed.details.reason) {
          Increment-SummaryCount -Table $lifecycleSymbolSummary.alertSuppressedByReason -Key ([string]$parsed.details.reason)
        }
        if ($parsed.details.family) {
          Increment-SummaryCount -Table $lifecycleSymbolSummary.alertSuppressedByFamily -Key ([string]$parsed.details.family)
        }
      }
    }

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

    $auditSymbolSummary = Ensure-SymbolSummary -Symbol ([string]$parsed.symbol)
    if ($auditSymbolSummary -ne $null) {
      if ($parsed.status -eq "posted") {
        $auditSymbolSummary.discordPosted += 1
      } elseif ($parsed.status -eq "failed") {
        $auditSymbolSummary.discordFailed += 1
      }
    }

    return
  }

  if ($parsed.type -eq "opportunity_snapshot" -or $parsed.type -eq "evaluation_update") {
    if ($parsed.type -eq "opportunity_snapshot") {
      $summary.opportunitySnapshots += 1
    } else {
      $summary.evaluationUpdates += 1
    }

    $opportunitySymbolSummary = Ensure-SymbolSummary -Symbol ([string]$parsed.symbol)
    if ($opportunitySymbolSummary -ne $null) {
      if ($parsed.type -eq "opportunity_snapshot") {
        $opportunitySymbolSummary.opportunitySnapshots += 1
      } else {
        $opportunitySymbolSummary.evaluationUpdates += 1
      }
    }
  }
}

function Save-SessionSummary {
  $summary.alerting.noisiestFamilies = Get-TopSummaryKeys -Table (Merge-CountTables `
    -Primary $summary.alerting.postedByFamily `
    -Secondary $summary.alerting.suppressedByFamily)
  Set-Content -LiteralPath $sessionSummaryPath -Value ($summary | ConvertTo-Json -Depth 10)
  Set-Content -LiteralPath $threadSummaryPath -Value ((Build-ThreadSummaries) | ConvertTo-Json -Depth 8)
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
Write-SessionInfo "thread_summaries=$threadSummaryPath"
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

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
$sessionReviewPath = Join-Path $sessionDirectory "session-review.md"
$feedbackPath = Join-Path $sessionDirectory "human-review-feedback.jsonl"
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
    noisiestSymbols = @()
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
  quality = @{
    score = 0
    verdict = "unknown"
    rationale = @()
    recommendations = @()
  }
  humanReview = @{
    total = 0
    byVerdict = @{}
    symbolsReviewed = 0
    latestAt = $null
  }
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
      quality = @{
        score = 0
        verdict = "unknown"
        rationale = @()
        recommendations = @()
      }
      humanReview = @{
        total = 0
        byVerdict = @{}
        latestVerdict = $null
        latestEventType = $null
        latestNotes = $null
        latestAt = $null
      }
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

function Sum-CountTable {
  param(
    [hashtable]$Table
  )

  if (-not $Table) {
    return 0
  }

  $total = 0
  foreach ($entry in $Table.GetEnumerator()) {
    $total += [int]$entry.Value
  }

  return $total
}

function Get-HashtableValue {
  param(
    [hashtable]$Table,
    [string]$Key,
    $Default
  )

  if ($null -ne $Table -and $Table.ContainsKey($Key) -and $null -ne $Table[$Key]) {
    return $Table[$Key]
  }

  return $Default
}

function Evaluate-QualityHeuristics {
  param(
    [hashtable]$Metrics
  )

  $posted = [int](Get-HashtableValue -Table $Metrics -Key "alertPosted" -Default 0)
  $suppressed = [int](Get-HashtableValue -Table $Metrics -Key "alertSuppressed" -Default 0)
  $snapshots = [int](Get-HashtableValue -Table $Metrics -Key "snapshotPosts" -Default 0)
  $discordFailed = [int](Get-HashtableValue -Table $Metrics -Key "discordFailed" -Default 0)
  $diagnostics = [int](Get-HashtableValue -Table $Metrics -Key "diagnosticEntries" -Default 0)
  $opportunitySnapshots = [int](Get-HashtableValue -Table $Metrics -Key "opportunitySnapshots" -Default 0)
  $postedFamiliesTable = [hashtable](Get-HashtableValue -Table $Metrics -Key "alertPostedByFamily" -Default @{})
  $suppressedReasonsTable = [hashtable](Get-HashtableValue -Table $Metrics -Key "alertSuppressedByReason" -Default @{})
  $families = [int]$postedFamiliesTable.Count
  $reasons = [int]$suppressedReasonsTable.Count
  $failureTotal =
    [int]$Metrics.failures.activation +
    [int]$Metrics.failures.restore +
    [int]$Metrics.failures.seed +
    [int]$Metrics.failures.ibkr

  $suppressionRatio =
    if (($posted + $suppressed) -gt 0) {
      [double]$suppressed / [double]($posted + $suppressed)
    } else {
      0
    }

  $score = 45
  $rationale = @()
  $recommendations = @()

  if ($snapshots -gt 0) {
    $score += [Math]::Min($snapshots * 4, 12)
    $rationale += "posted snapshots"
  }

  if ($posted -gt 0) {
    $score += [Math]::Min($posted * 6, 18)
    $rationale += "posted trader-facing alerts"
  }

  if ($families -ge 2) {
    $score += 6
    $rationale += "showed multiple alert families"
  } elseif ($families -eq 1 -and $posted -gt 0) {
    $score += 2
  }

  if ($opportunitySnapshots -gt 0) {
    $score += 4
    $rationale += "produced opportunity snapshots"
  }

  if ($failureTotal -gt 0) {
    $score -= [Math]::Min($failureTotal * 12, 36)
    $rationale += "hit runtime failures"
    $recommendations += "check activation/seed/restore failures first"
  }

  if ($discordFailed -gt 0) {
    $score -= [Math]::Min($discordFailed * 10, 20)
    $rationale += "had Discord delivery failures"
    $recommendations += "review discord-delivery-audit.jsonl for failed posts"
  }

  if ($suppressionRatio -ge 0.75 -and ($posted + $suppressed) -ge 4) {
    $score -= 18
    $rationale += "was mostly suppression-heavy"
    $recommendations += "consider whether this symbol or alert family is too noisy"
  } elseif ($suppressionRatio -ge 0.5 -and ($posted + $suppressed) -ge 4) {
    $score -= 10
    $rationale += "showed moderate suppression pressure"
  }

  if ($diagnostics -ge 20 -and $posted -eq 0) {
    $score -= 10
    $rationale += "generated diagnostics without trader-facing output"
    $recommendations += "review whether detector chatter is producing value"
  }

  if ($posted -eq 0 -and $snapshots -eq 0 -and $failureTotal -eq 0) {
    $score -= 8
    $rationale += "did not produce meaningful visible output"
  }

  $score = [Math]::Max(0, [Math]::Min(100, [int][Math]::Round($score)))
  $verdict =
    if ($failureTotal -gt 0 -or $discordFailed -gt 1) {
      "needs_attention"
    } elseif ($score -ge 75) {
      "high_signal"
    } elseif ($score -ge 60) {
      "useful"
    } elseif ($score -ge 45) {
      "mixed"
    } else {
      "noisy"
    }

  if ($recommendations.Count -eq 0) {
    if ($verdict -eq "high_signal" -or $verdict -eq "useful") {
      $recommendations += "keep this symbol in the live test mix"
    } elseif ($verdict -eq "mixed") {
      $recommendations += "review thread-summaries.json and discord-delivery-audit.jsonl together"
    } else {
      $recommendations += "review suppression reasons and alert family balance before trusting this thread"
    }
  }

  return @{
    score = $score
    verdict = $verdict
    rationale = @($rationale | Select-Object -Unique)
    recommendations = @($recommendations | Select-Object -Unique)
  }
}

function Build-SessionQualitySummary {
  $symbolScores = @(
    $summary.perSymbol.GetEnumerator() |
      ForEach-Object { [int]$_.Value.quality.score }
  )
  $averageScore =
    if ($symbolScores.Count -gt 0) {
      [int][Math]::Round(($symbolScores | Measure-Object -Average).Average)
    } else {
      0
    }

  $sessionMetrics = @{
    alertPosted = $summary.alerting.posted
    alertSuppressed = $summary.alerting.suppressed
    snapshotPosts = [int](Get-HashtableValue -Table $summary.lifecycleCounts -Key "snapshot_posted" -Default 0)
    discordFailed = $summary.discordAudit.failed
    diagnosticEntries = $summary.diagnosticEntries
    opportunitySnapshots = $summary.opportunitySnapshots
    alertPostedByFamily = $summary.alerting.postedByFamily
    alertSuppressedByReason = $summary.alerting.suppressedByReason
    failures = $summary.failures
  }
  $quality = Evaluate-QualityHeuristics -Metrics $sessionMetrics
  $quality.averageSymbolScore = $averageScore
  return $quality
}

function Get-NoisiestSymbols {
  param(
    [int]$Top = 3
  )

  return @(
    $summary.perSymbol.GetEnumerator() |
      Sort-Object -Property @{
        Expression = {
          [int]$_.Value.alertSuppressed +
          [int]$_.Value.diagnosticEntries +
          [int]$_.Value.discordFailed * 4
        }
        Descending = $true
      }, @{ Expression = "Key"; Descending = $false } |
      Select-Object -First $Top |
      ForEach-Object {
        $noiseScore =
          [int]$_.Value.alertSuppressed +
          [int]$_.Value.diagnosticEntries +
          [int]$_.Value.discordFailed * 4
        if ($noiseScore -gt 0) {
          "$($_.Key) noise=$noiseScore"
        }
      } |
      Where-Object { $_ }
  )
}

function Reset-HumanReviewSummary {
  $summary.humanReview = @{
    total = 0
    byVerdict = @{}
    symbolsReviewed = 0
    latestAt = $null
  }

  foreach ($symbol in $summary.perSymbol.Keys) {
    $summary.perSymbol[$symbol].humanReview = @{
      total = 0
      byVerdict = @{}
      latestVerdict = $null
      latestEventType = $null
      latestNotes = $null
      latestAt = $null
    }
  }
}

function Apply-HumanReviewFeedbackFromFile {
  if (-not (Test-Path -LiteralPath $feedbackPath)) {
    Reset-HumanReviewSummary
    return
  }

  Reset-HumanReviewSummary
  $reviewedSymbols = @{}

  foreach ($line in (Get-Content -LiteralPath $feedbackPath -ErrorAction SilentlyContinue)) {
    if ([string]::IsNullOrWhiteSpace($line)) {
      continue
    }

    try {
      $parsed = $line | ConvertFrom-Json -ErrorAction Stop
    } catch {
      continue
    }

    $symbol = if ($parsed.symbol) { [string]$parsed.symbol } else { $null }
    $verdict = if ($parsed.verdict) { [string]$parsed.verdict } else { "unclassified" }
    $symbolSummary = Ensure-SymbolSummary -Symbol $symbol

    $summary.humanReview.total += 1
    Increment-SummaryCount -Table $summary.humanReview.byVerdict -Key $verdict
    if ($parsed.timestamp -and (-not $summary.humanReview.latestAt -or [string]$parsed.timestamp -gt [string]$summary.humanReview.latestAt)) {
      $summary.humanReview.latestAt = [string]$parsed.timestamp
    }

    if ($symbolSummary -ne $null) {
      $reviewedSymbols[$symbol.ToUpperInvariant()] = $true
      $symbolSummary.humanReview.total += 1
      Increment-SummaryCount -Table $symbolSummary.humanReview.byVerdict -Key $verdict
      if ($parsed.timestamp -and (-not $symbolSummary.humanReview.latestAt -or [string]$parsed.timestamp -gt [string]$symbolSummary.humanReview.latestAt)) {
        $symbolSummary.humanReview.latestAt = [string]$parsed.timestamp
        $symbolSummary.humanReview.latestVerdict = $verdict
        $symbolSummary.humanReview.latestEventType = if ($parsed.eventType) { [string]$parsed.eventType } else { $null }
        $symbolSummary.humanReview.latestNotes = if ($parsed.notes) { [string]$parsed.notes } else { $null }
      }
    }
  }

  $summary.humanReview.symbolsReviewed = $reviewedSymbols.Count
}

function Build-EndOfSessionSummary {
  param(
    [string]$Symbol,
    [hashtable]$SymbolSummary
  )

  $failureTotal =
    [int]$SymbolSummary.failures.activation +
    [int]$SymbolSummary.failures.restore +
    [int]$SymbolSummary.failures.seed +
    [int]$SymbolSummary.failures.ibkr
  $families = Get-TopSummaryKeys -Table $SymbolSummary.alertPostedByFamily -Top 2
  $reviewVerdict = $SymbolSummary.humanReview.latestVerdict

  if ($failureTotal -gt 0) {
    return "$Symbol hit $failureTotal runtime failure(s) during the session and needs operational cleanup before trusting the thread."
  }

  if ($reviewVerdict -eq "wrong" -or $reviewVerdict -eq "late") {
    return "$Symbol has explicit human review feedback of $reviewVerdict, so this thread should be treated cautiously until the underlying alert quality is tuned."
  }

  if ($SymbolSummary.alertPosted -ge 2 -and $SymbolSummary.quality.verdict -in @("high_signal", "useful")) {
    return "$Symbol produced multiple posted alerts and held a $($SymbolSummary.quality.verdict) verdict; families: $(Join-DisplayList -Items $families)."
  }

  if ($SymbolSummary.alertSuppressed -gt $SymbolSummary.alertPosted -and $SymbolSummary.alertSuppressed -ge 3) {
    return "$Symbol spent more time suppressing alerts than posting them, which points to repetitive or low-value conditions rather than a clean thread."
  }

  if ($SymbolSummary.snapshotPosts -gt 0 -and $SymbolSummary.alertPosted -eq 0) {
    return "$Symbol stayed mostly observational: snapshots posted, but no trader-facing alerts cleared the posting bar."
  }

  if ($reviewVerdict -eq "useful" -or $reviewVerdict -eq "strong") {
    return "$Symbol received positive human review feedback, which is a good sign that the thread was adding value to the end user."
  }

  if ($SymbolSummary.lastAlert -and $SymbolSummary.lastAlert.tacticalRead -eq "tired") {
    return "$Symbol ended with a tactically tired alert context, so the thread may still matter structurally but deserves more caution on follow-through."
  }

  if ($SymbolSummary.lastAlert -and $SymbolSummary.lastAlert.tacticalRead -eq "firm") {
    return "$Symbol ended with a firm alert context, which is a better sign that the underlying zone still had real structure behind it."
  }

  if ($SymbolSummary.lastAlert -and $SymbolSummary.lastAlert.clearanceLabel) {
    return "$Symbol ended with a $($SymbolSummary.lastAlert.clearanceLabel) room alert context, which should shape how aggressively the latest setup is interpreted."
  }

  return "$Symbol remained $($SymbolSummary.quality.verdict) overall, and the thread should be reviewed alongside its latest alert and suppression mix."
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
    if ($SymbolSummary.lastAlert.clearanceLabel) {
      $latestAlertSummary += ("room=" + [string]$SymbolSummary.lastAlert.clearanceLabel)
    }
    if ($SymbolSummary.lastAlert.tacticalRead) {
      $latestAlertSummary += ("zone=" + [string]$SymbolSummary.lastAlert.tacticalRead)
    }
    if ($SymbolSummary.lastAlert.nextBarrierSide -and $SymbolSummary.lastAlert.nextBarrierDistancePct -ne $null) {
      $distancePct = ([double]$SymbolSummary.lastAlert.nextBarrierDistancePct * 100).ToString("0.0")
      $latestAlertSummary += ([string]$SymbolSummary.lastAlert.nextBarrierSide + "=" + $distancePct + "%")
    }
    $latestAlertSummary = $latestAlertSummary | Where-Object { $_ }
  }

  return [ordered]@{
    symbol = $Symbol
    status = $status
    verdict = $SymbolSummary.quality.verdict
    score = $SymbolSummary.quality.score
    endOfSessionSummary = Build-EndOfSessionSummary -Symbol $Symbol -SymbolSummary $SymbolSummary
    headline = ($headlineParts -join " | ")
    rationale = $SymbolSummary.quality.rationale
    recommendations = $SymbolSummary.quality.recommendations
    humanReview = $SymbolSummary.humanReview
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

function Join-DisplayList {
  param(
    [object[]]$Items,
    [string]$Fallback = "none"
  )

  if (-not $Items -or $Items.Count -eq 0) {
    return $Fallback
  }

  return (($Items | Where-Object { $_ }) -join ", ")
}

function Build-SessionReviewLines {
  param(
    [object[]]$ThreadSummaries
  )

  $quality = $summary.quality
  $lines = @(
    "# Long-Run Session Review",
    "",
    "## Session Verdict",
    "",
    "- Verdict: $($quality.verdict)",
    "- Score: $($quality.score)",
    "- Average symbol score: $($quality.averageSymbolScore)",
    "- Started: $($summary.startedAt)",
    "- Ended: $($summary.endedAt)",
    "- Diagnostics enabled: $($summary.diagnosticsEnabled)",
    "- Active symbols tracked: $($summary.perSymbol.Count)",
    "- Alerts posted: $($summary.alerting.posted)",
    "- Alerts suppressed: $($summary.alerting.suppressed)",
    "- Discord posted: $($summary.discordAudit.posted)",
    "- Discord failed: $($summary.discordAudit.failed)",
    "- Noisiest families: $(Join-DisplayList -Items $summary.alerting.noisiestFamilies)",
    "- Noisiest symbols: $(Join-DisplayList -Items $summary.alerting.noisiestSymbols)",
    "",
    "### Rationale",
    ""
  )

  foreach ($reason in @($quality.rationale)) {
    $lines += "- $reason"
  }

  if ($quality.rationale.Count -eq 0) {
    $lines += "- none recorded yet"
  }

  $lines += @(
    "",
    "### Recommendations",
    ""
  )

  foreach ($recommendation in @($quality.recommendations)) {
    $lines += "- $recommendation"
  }

  if ($quality.recommendations.Count -eq 0) {
    $lines += "- none recorded yet"
  }

  $lines += @(
    "",
    "## Human Review",
    "",
    "- Total feedback entries: $($summary.humanReview.total)",
    "- Symbols reviewed: $($summary.humanReview.symbolsReviewed)",
    "- Review verdicts: $(Join-DisplayList -Items (Get-TopSummaryKeys -Table $summary.humanReview.byVerdict -Top 5))",
    "- Latest feedback at: $(if ($summary.humanReview.latestAt) { $summary.humanReview.latestAt } else { 'none yet' })",
    "",
    "",
    "## Symbol Threads",
    ""
  )

  if (-not $ThreadSummaries -or $ThreadSummaries.Count -eq 0) {
    $lines += "- No symbol activity recorded yet."
    return $lines
  }

  foreach ($thread in $ThreadSummaries) {
    $lines += @(
      "### $($thread.symbol)",
      "",
      "- Verdict: $($thread.verdict) ($($thread.score))",
      "- Headline: $($thread.headline)",
      "- End-of-session summary: $($thread.endOfSessionSummary)",
      "- Top posted families: $(Join-DisplayList -Items $thread.topPostedFamilies)",
      "- Top suppression reasons: $(Join-DisplayList -Items $thread.topSuppressionReasons)",
      "- Lifecycle highlights: $(Join-DisplayList -Items $thread.lifecycleHighlights)",
      "- Latest alert summary: $(if ($thread.latestAlertSummary) { $thread.latestAlertSummary } else { 'none' })",
      "- Human review: $(if ($thread.humanReview.total -gt 0) { ('latest=' + $thread.humanReview.latestVerdict + '; total=' + $thread.humanReview.total) } else { 'none yet' })",
      "- Discord posted: $($thread.discordPosted)",
      "- Discord failed: $($thread.discordFailed)",
      ""
    )

    $lines += "#### Why this verdict"
    $lines += ""
    foreach ($reason in @($thread.rationale)) {
      $lines += "- $reason"
    }
    if ($thread.rationale.Count -eq 0) {
      $lines += "- none recorded yet"
    }

    $lines += @(
      "",
      "#### What to do next",
      ""
    )
    foreach ($recommendation in @($thread.recommendations)) {
      $lines += "- $recommendation"
    }
    if ($thread.recommendations.Count -eq 0) {
      $lines += "- none recorded yet"
    }

    $lines += ""
  }

  return $lines
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
          clearanceLabel = $parsed.details.clearanceLabel
          nextBarrierSide = $parsed.details.nextBarrierSide
          nextBarrierDistancePct = $parsed.details.nextBarrierDistancePct
          tacticalRead = $parsed.details.tacticalRead
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
  foreach ($symbol in $summary.perSymbol.Keys) {
    $symbolSummary = $summary.perSymbol[$symbol]
    $symbolSummary.quality = Evaluate-QualityHeuristics -Metrics @{
      alertPosted = $symbolSummary.alertPosted
      alertSuppressed = $symbolSummary.alertSuppressed
      snapshotPosts = $symbolSummary.snapshotPosts
      discordFailed = $symbolSummary.discordFailed
      diagnosticEntries = $symbolSummary.diagnosticEntries
      opportunitySnapshots = $symbolSummary.opportunitySnapshots
      alertPostedByFamily = $symbolSummary.alertPostedByFamily
      alertSuppressedByReason = $symbolSummary.alertSuppressedByReason
      failures = $symbolSummary.failures
    }
  }

  $summary.alerting.noisiestFamilies = Get-TopSummaryKeys -Table (Merge-CountTables `
    -Primary $summary.alerting.postedByFamily `
    -Secondary $summary.alerting.suppressedByFamily)
  $summary.alerting.noisiestSymbols = Get-NoisiestSymbols
  $summary.quality = Build-SessionQualitySummary
  Apply-HumanReviewFeedbackFromFile
  $threadSummaries = Build-ThreadSummaries
  Set-Content -LiteralPath $sessionSummaryPath -Value ($summary | ConvertTo-Json -Depth 10)
  Set-Content -LiteralPath $threadSummaryPath -Value ($threadSummaries | ConvertTo-Json -Depth 8)
  Set-Content -LiteralPath $sessionReviewPath -Value ((Build-SessionReviewLines -ThreadSummaries $threadSummaries) -join [Environment]::NewLine)
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
Write-SessionInfo "session_review=$sessionReviewPath"
Write-SessionInfo "human_review_feedback=$feedbackPath"
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

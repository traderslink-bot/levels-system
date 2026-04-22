param(
  [Parameter(Mandatory = $true)]
  [string]$SessionDirectory,

  [Parameter(Mandatory = $true)]
  [string]$Symbol,

  [Parameter(Mandatory = $true)]
  [ValidateSet("useful", "noisy", "late", "wrong", "strong")]
  [string]$Verdict,

  [string]$EventType,

  [string]$Notes
)

$resolvedSessionDirectory = Resolve-Path -LiteralPath $SessionDirectory -ErrorAction Stop
$feedbackPath = Join-Path $resolvedSessionDirectory "human-review-feedback.jsonl"
$entry = [ordered]@{
  timestamp = Get-Date -Format o
  symbol = $Symbol.Trim().ToUpperInvariant()
  verdict = $Verdict
  eventType = if ([string]::IsNullOrWhiteSpace($EventType)) { $null } else { $EventType.Trim() }
  notes = if ([string]::IsNullOrWhiteSpace($Notes)) { $null } else { $Notes.Trim() }
}

Add-Content -LiteralPath $feedbackPath -Value ($entry | ConvertTo-Json -Compress)

Write-Host "Recorded human review feedback."
Write-Host "Session: $resolvedSessionDirectory"
Write-Host "Feedback file: $feedbackPath"
Write-Host "Symbol: $($entry.symbol)"
Write-Host "Verdict: $($entry.verdict)"
if ($entry.eventType) {
  Write-Host "Event type: $($entry.eventType)"
}
if ($entry.notes) {
  Write-Host "Notes: $($entry.notes)"
}
Write-Host "If the long-run session is still running, the summary artifacts will incorporate this feedback on the next runtime update."

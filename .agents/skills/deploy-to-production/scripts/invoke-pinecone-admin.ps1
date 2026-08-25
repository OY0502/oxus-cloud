[CmdletBinding()]
param(
  [ValidateSet("status", "setup", "process_outbox", "test_query")]
  [string]$Action,
  [string]$ProjectId,
  [string]$Query,
  [switch]$DryRun,
  [string]$ConfirmationPhrase
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRef = "xyphlqyujifneqqtzmto"
$functionUrl = "https://$projectRef.supabase.co/functions/v1/pinecone-chat-memory"
$mutatesProduction = $Action -ne "status"
$expectedConfirmation = "CONFIRM $Action production"

if ($Action -ne "process_outbox" -and -not $ProjectId) {
  throw "ProjectId is required for action '$Action'."
}
if ($Action -eq "test_query" -and -not $Query) {
  throw "Query is required for test_query."
}

if ($DryRun) {
  [pscustomobject]@{
    dry_run = $true
    action = $Action
    project_id = $ProjectId
    endpoint = $functionUrl
    production_mutation = $mutatesProduction
    required_confirmation = if ($mutatesProduction) { $expectedConfirmation } else { $null }
  } | ConvertTo-Json
  exit 0
}

if ($mutatesProduction -and $ConfirmationPhrase -cne $expectedConfirmation) {
  throw "Production confirmation missing. After the user confirms in chat, pass -ConfirmationPhrase '$expectedConfirmation'."
}

$key = $null
try {
  $rawKeys = npx --yes supabase@2.109.1 projects api-keys --project-ref $projectRef --output json
  if ($LASTEXITCODE -ne 0) { throw "Could not retrieve Supabase API-key metadata." }
  $keys = $rawKeys | ConvertFrom-Json
  $key = ($keys | Where-Object { $_.name -eq "service_role" }).api_key
  if (-not $key) { throw "Service-role key is unavailable from the authenticated Supabase CLI." }

  $headers = @{
    Authorization = "Bearer $key"
    apikey = $key
    "Content-Type" = "application/json"
  }
  $body = @{ action = $Action }
  if ($ProjectId) { $body.project_id = $ProjectId }
  if ($Query) { $body.query = $Query }

  Invoke-RestMethod -Method Post -Uri $functionUrl -Headers $headers -Body ($body | ConvertTo-Json) -TimeoutSec 600 |
    ConvertTo-Json -Depth 8
} finally {
  $key = $null
  Remove-Variable rawKeys, keys -ErrorAction SilentlyContinue
}

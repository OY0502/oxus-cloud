[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRef = "proj_obirqjqllcyukpslcckr"
$requiredNames = @("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
$appRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..\artifacts\oxus-cloud")).Path
$npx = (Get-Command "npx" -ErrorAction Stop).Source

Push-Location $appRoot
try {
  $lines = @(& $npx --yes trigger.dev@4.5.0 env list --project-ref $projectRef --env prod --skip-telemetry 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "Trigger.dev Production environment lookup failed."
  }

  $output = ($lines | Out-String)
  foreach ($name in $requiredNames) {
    if ($output -notmatch "(?m)^\s*$([regex]::Escape($name))\s+") {
      throw "Trigger.dev Production is missing required variable name '$name'."
    }
  }

  [pscustomobject]@{
    project_ref = $projectRef
    environment = "prod"
    required_names = ($requiredNames -join ", ")
    values_displayed = $false
  } | Format-List

  Write-Output "Required Trigger.dev Production variable names are present; values were not requested or displayed."
} finally {
  Pop-Location
}

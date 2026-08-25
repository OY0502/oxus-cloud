[CmdletBinding()]
param(
  [switch]$SkipTests,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path
$appRoot = Join-Path $repoRoot "artifacts\oxus-cloud"

function Assert-Equal([string]$Label, [string]$Actual, [string]$Expected) {
  if ($Actual -ne $Expected) {
    throw "$Label mismatch. Expected '$Expected'; found '$Actual'."
  }
}

function Resolve-AppBinary([string]$Name) {
  $candidates = @(
    (Join-Path $appRoot "node_modules\.bin\$Name.CMD"),
    (Join-Path $appRoot "node_modules\.bin\$Name")
  )
  $binary = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $binary) { throw "Missing app-local binary '$Name'. Install workspace dependencies first." }
  return $binary
}

Push-Location $repoRoot
try {
  $branch = (git branch --show-current).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Could not determine the Git branch." }
  Assert-Equal "Git branch" $branch "main"

  $dirty = @(git status --porcelain)
  if ($LASTEXITCODE -ne 0) { throw "Could not determine the Git working-tree state." }
  if ($dirty.Count -gt 0) {
    throw "Production releases require a clean working tree; found $($dirty.Count) changed path(s). Do not reset, clean, commit, or push without separate user authorization."
  }

  $upstream = (git rev-parse --abbrev-ref --symbolic-full-name '@{u}').Trim()
  if ($LASTEXITCODE -ne 0) { throw "Branch 'main' has no configured upstream." }
  Assert-Equal "Git upstream" $upstream "origin/main"

  $headCommit = (git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Could not resolve the local release commit." }
  $originMainCommit = (git rev-parse origin/main).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Could not resolve origin/main. Run 'git fetch origin main' before preflight." }
  Assert-Equal "Pushed main commit" $headCommit $originMainCommit

  $originUrl = (git remote get-url origin).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Could not resolve the origin remote." }
  Assert-Equal "Git origin" $originUrl "https://github.com/OY0502/oxus-cloud.git"

  $vercel = Get-Content -Raw -LiteralPath (Join-Path $appRoot ".vercel\project.json") | ConvertFrom-Json
  Assert-Equal "Vercel project ID" $vercel.projectId "prj_qbYPLFS9Ct96amuyIK7hpNAnfBDz"
  Assert-Equal "Vercel org ID" $vercel.orgId "team_WCQTCMadHEiNgE8IaIyzu8tr"
  Assert-Equal "Vercel project name" $vercel.projectName "oxus-cloud"

  $supabaseRef = (Get-Content -Raw -LiteralPath (Join-Path $appRoot "supabase\.temp\project-ref")).Trim()
  Assert-Equal "Supabase project ref" $supabaseRef "xyphlqyujifneqqtzmto"

  $triggerConfig = Get-Content -Raw -LiteralPath (Join-Path $appRoot "trigger.config.ts")
  if (-not $triggerConfig.Contains('project: "proj_obirqjqllcyukpslcckr"')) {
    throw "Trigger.dev production project ref mismatch."
  }

  [pscustomobject]@{
    repository = $repoRoot
    branch = $branch
    release_commit = $headCommit
    upstream = $upstream
    working_tree = "clean"
    supabase_project_ref = $supabaseRef
    vercel_project = $vercel.projectName
    trigger_project_ref = "proj_obirqjqllcyukpslcckr"
  } | Format-List

  if (-not $SkipTests) {
    Push-Location $appRoot
    try {
      & (Resolve-AppBinary "vitest") run
      if ($LASTEXITCODE -ne 0) { throw "Test suite failed." }
      & (Resolve-AppBinary "tsc") -p tsconfig.json --noEmit
      if ($LASTEXITCODE -ne 0) { throw "Typecheck failed." }
    } finally {
      Pop-Location
    }
  }

  if (-not $SkipBuild) {
    Push-Location $appRoot
    try {
      & (Resolve-AppBinary "vite") build
      if ($LASTEXITCODE -ne 0) { throw "Production build failed." }
    } finally {
      Pop-Location
    }
  }

  Write-Output "Local production preflight passed. No production service was changed."
} finally {
  Pop-Location
}

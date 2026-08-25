[CmdletBinding()]
param(
  [string]$ProductionUrl = "https://oxus.cloud"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$html = Invoke-WebRequest -Uri $ProductionUrl -UseBasicParsing -TimeoutSec 60
if ($html.StatusCode -ne 200) { throw "Production returned HTTP $($html.StatusCode)." }

$assetPath = [regex]::Match($html.Content, 'src="([^"]+\.js)"').Groups[1].Value
if (-not $assetPath) { throw "Could not locate the production JavaScript asset." }
$assetUrl = [Uri]::new([Uri]$ProductionUrl, $assetPath).AbsoluteUri
$bundle = Invoke-WebRequest -Uri $assetUrl -UseBasicParsing -TimeoutSec 120

$result = [ordered]@{
  status = $html.StatusCode
  asset = $assetPath
  new_chat_ui = $bundle.Content.Contains("New chat")
  delete_chat_ui = $bundle.Content.Contains("Delete current chat")
  pinecone_ui = $bundle.Content.Contains("Pinecone retrieval")
}

if (-not ($result.new_chat_ui -and $result.delete_chat_ui -and $result.pinecone_ui)) {
  throw "Production bundle is missing one or more required release markers: $($result | ConvertTo-Json -Compress)"
}

[pscustomobject]$result | ConvertTo-Json

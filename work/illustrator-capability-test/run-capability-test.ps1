param(
  [string]$ScriptPath
)

$ErrorActionPreference = "Stop"

$repoRoot = "C:\Projects\Anybox"
if ([string]::IsNullOrWhiteSpace($ScriptPath)) {
  $ScriptPath = Join-Path $repoRoot "work\illustrator-capability-test\capability-test.jsx"
} else {
  $ScriptPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $ScriptPath))
}
$outputDir = Join-Path $repoRoot "tmp\illustrator-capability-test"

New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

try {
  $illustrator = [Runtime.InteropServices.Marshal]::GetActiveObject("Illustrator.Application")
} catch {
  $illustrator = New-Object -ComObject "Illustrator.Application"
}

$script = Get-Content -LiteralPath $ScriptPath -Raw
$result = $illustrator.DoJavaScript($script)
Write-Output $result

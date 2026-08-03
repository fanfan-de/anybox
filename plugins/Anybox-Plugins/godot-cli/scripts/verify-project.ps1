[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ProjectPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw 'PowerShell 7 or newer is required.'
}

. (Join-Path $PSScriptRoot 'project-package.ps1')

$context = Get-GodotCliPackageContext
$projectRoot = Resolve-GodotProjectRoot $ProjectPath
$marker = Read-InstallMarker $projectRoot
$snapshots = @(
    $context.Files | ForEach-Object {
        Get-TargetSnapshot $projectRoot $_
    }
)
$missing = @(
    $snapshots | Where-Object { -not $_.Exists } | ForEach-Object { $_.File.Target }
)
$modified = @(
    $snapshots |
        Where-Object { $_.Exists -and -not $_.MatchesPayload } |
        ForEach-Object { $_.File.Target }
)
$installedVersion = if ($null -ne $marker) { [string]$marker.version } else { $null }
$ok = $null -ne $marker -and
    $installedVersion -eq $context.Version -and
    $missing.Count -eq 0 -and
    $modified.Count -eq 0

[ordered]@{
    ok = $ok
    mode = 'verify'
    status = if ($ok) { 'current' } else { 'invalid' }
    pluginID = $context.PluginID
    expectedVersion = $context.Version
    installedVersion = $installedVersion
    projectPath = $projectRoot
    markerPresent = $null -ne $marker
    missing = @($missing)
    modified = @($modified)
} | ConvertTo-Json -Depth 16

if (-not $ok) {
    exit 1
}

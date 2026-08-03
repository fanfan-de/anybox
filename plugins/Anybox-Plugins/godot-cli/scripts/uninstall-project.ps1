[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ProjectPath,

    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw 'PowerShell 7 or newer is required.'
}

. (Join-Path $PSScriptRoot 'project-package.ps1')

$context = Get-GodotCliPackageContext
$projectRoot = Resolve-GodotProjectRoot $ProjectPath
$markerPath = Get-InstallMarkerPath $projectRoot
$marker = Read-InstallMarker $projectRoot
if ($null -eq $marker) {
    throw 'No Anybox-managed Godot CLI installation exists in this project.'
}

$managedFiles = @()
$modified = @()
foreach ($file in @($marker.files)) {
    $target = ConvertTo-SafeRelativePath ([string]$file.target) 'Marker target'
    $sha256 = ([string]$file.sha256).ToLowerInvariant()
    if ($sha256 -notmatch '^[a-f0-9]{64}$') {
        throw "Install marker SHA-256 is invalid for $target."
    }
    $targetPath = Resolve-ContainedPath $projectRoot $target 'Uninstall target'
    $exists = Test-Path -LiteralPath $targetPath -PathType Leaf
    if ($exists -and (Get-FileSha256 $targetPath) -ne $sha256) {
        $modified += $target
    }
    $managedFiles += [pscustomobject]@{
        Target = $target
        TargetPath = $targetPath
        Exists = $exists
    }
}

if ($modified.Count -gt 0) {
    $list = $modified -join ', '
    throw "Managed Godot CLI files were modified locally; refusing to delete them: $list"
}

$existingFiles = @($managedFiles | Where-Object { $_.Exists })
$backupPath = if (
    $marker.PSObject.Properties.Name -contains 'backupPath'
) {
    [string]$marker.backupPath
}
else {
    $null
}

function New-UninstallResult {
    param(
        [string]$Status,
        [bool]$Applied
    )

    return [ordered]@{
        ok = $true
        mode = 'uninstall'
        status = $Status
        applied = $Applied
        pluginID = $context.PluginID
        installedVersion = [string]$marker.version
        projectPath = $projectRoot
        applyRequired = $true
        managedFilesPresent = $existingFiles.Count
        preservedBackupPath = $backupPath
    }
}

if (-not $Apply) {
    New-UninstallResult 'uninstall-ready' $false | ConvertTo-Json -Depth 16
    exit 0
}

$removedPaths = [System.Collections.Generic.List[string]]::new()
foreach ($file in $existingFiles) {
    Remove-Item -LiteralPath $file.TargetPath -Force
    $removedPaths.Add($file.TargetPath)
}
if (Test-Path -LiteralPath $markerPath -PathType Leaf) {
    Remove-Item -LiteralPath $markerPath -Force
    $removedPaths.Add($markerPath)
}
Remove-EmptyInstallParents $projectRoot @($removedPaths)

New-UninstallResult 'uninstalled' $true | ConvertTo-Json -Depth 16

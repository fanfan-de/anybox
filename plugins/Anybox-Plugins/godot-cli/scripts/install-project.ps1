[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ProjectPath,

    [switch]$Upgrade,

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
$snapshots = @(
    $context.Files | ForEach-Object {
        Get-TargetSnapshot $projectRoot $_
    }
)

$markerByTarget = @{}
$modifiedOwnedFiles = @()
if ($null -ne $marker) {
    foreach ($file in @($marker.files)) {
        $target = ConvertTo-SafeRelativePath ([string]$file.target) 'Marker target'
        $sha256 = ([string]$file.sha256).ToLowerInvariant()
        if ($sha256 -notmatch '^[a-f0-9]{64}$') {
            throw "Install marker SHA-256 is invalid for $target."
        }
        if ($markerByTarget.ContainsKey($target)) {
            throw "Install marker target is duplicated: $target."
        }
        $markerByTarget[$target] = [pscustomobject]@{
            Target = $target
            Sha256 = $sha256
            Size = [long]$file.size
        }
        $targetPath = Resolve-ContainedPath $projectRoot $target 'Marker target'
        if (Test-Path -LiteralPath $targetPath -PathType Leaf) {
            $currentHash = Get-FileSha256 $targetPath
            if ($currentHash -ne $sha256) {
                $modifiedOwnedFiles += $target
            }
        }
    }
}

if ($modifiedOwnedFiles.Count -gt 0) {
    $list = $modifiedOwnedFiles -join ', '
    throw "Managed Godot CLI files were modified locally; refusing to overwrite them: $list"
}

$payloadTargets = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::OrdinalIgnoreCase
)
foreach ($file in $context.Files) {
    [void]$payloadTargets.Add($file.Target)
}

$staleMarkerFiles = @(
    $markerByTarget.Values | Where-Object {
        -not $payloadTargets.Contains($_.Target)
    }
)
$changes = @($snapshots | Where-Object { -not $_.MatchesPayload })
$conflicts = @(
    $changes | Where-Object {
        if (-not $_.Exists) {
            return $false
        }
        if (-not $markerByTarget.ContainsKey($_.File.Target)) {
            return $true
        }
        return $_.Sha256 -ne $markerByTarget[$_.File.Target].Sha256
    } | ForEach-Object { $_.File.Target }
)
$markerVersion = if ($null -ne $marker) { [string]$marker.version } else { $null }
$versionChanged = $null -ne $marker -and $markerVersion -ne $context.Version
$requiresUpgrade = $versionChanged -or
    $staleMarkerFiles.Count -gt 0 -or
    @($changes | Where-Object { $_.Exists }).Count -gt 0
$applyRequired = $changes.Count -gt 0 -or
    $staleMarkerFiles.Count -gt 0 -or
    $null -eq $marker -or
    $versionChanged
$godotProcesses = @(
    Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessName -match '^Godot' } |
        Select-Object ProcessName, Id
)

function New-InstallResult {
    param(
        [string]$Status,
        [bool]$Applied,
        [string]$BackupPath = $null
    )

    return [ordered]@{
        ok = $true
        mode = 'install'
        status = $Status
        applied = $Applied
        pluginID = $context.PluginID
        version = $context.Version
        previousVersion = $markerVersion
        projectPath = $projectRoot
        applyRequired = $applyRequired
        requiresUpgrade = $requiresUpgrade
        changedFiles = $changes.Count
        staleFiles = $staleMarkerFiles.Count
        conflicts = @($conflicts)
        godotProcessesRunning = @($godotProcesses)
        backupPath = $BackupPath
    }
}

if (-not $Apply) {
    $status = if (-not $applyRequired) {
        'current'
    }
    elseif ($requiresUpgrade) {
        'upgrade-ready'
    }
    else {
        'install-ready'
    }
    New-InstallResult $status $false | ConvertTo-Json -Depth 16
    exit 0
}

if ($requiresUpgrade -and -not $Upgrade) {
    throw 'Existing Godot CLI files require an explicitly approved -Upgrade before -Apply.'
}

if (-not $applyRequired) {
    New-InstallResult 'current' $false | ConvertTo-Json -Depth 16
    exit 0
}

$transactionID = [guid]::NewGuid().ToString('N')
$transactionRoot = Resolve-ContainedPath `
    $projectRoot `
    ".godot-cli/.install-transactions/$transactionID" `
    'Install transaction'
$stageRoot = Join-Path $transactionRoot 'stage'
$rollbackRoot = Join-Path $transactionRoot 'rollback'
$markerBackup = Join-Path $transactionRoot 'marker.json'
$persistentBackupRoot = $null
$persistentBackupRelative = $null

if ($Upgrade -and ($changes.Count -gt 0 -or $staleMarkerFiles.Count -gt 0)) {
    $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $persistentBackupRelative = ".godot-cli/backups/godot-cli/$timestamp-$transactionID"
    $persistentBackupRoot = Resolve-ContainedPath `
        $projectRoot `
        $persistentBackupRelative `
        'Upgrade backup'
}

$originalTargets = @{}
$newTargetPaths = [System.Collections.Generic.List[string]]::new()
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
New-Item -ItemType Directory -Path $rollbackRoot -Force | Out-Null

try {
    foreach ($snapshot in $changes) {
        $stagePath = Resolve-ContainedPath $stageRoot $snapshot.File.Target 'Staged target'
        New-Item -ItemType Directory -Path (Split-Path -Parent $stagePath) -Force |
            Out-Null
        Copy-Item -LiteralPath $snapshot.File.SourcePath -Destination $stagePath -Force
        if ((Get-FileSha256 $stagePath) -ne $snapshot.File.Sha256) {
            throw "Staged payload verification failed for $($snapshot.File.Target)."
        }

        $originalTargets[$snapshot.File.Target] = $snapshot.Exists
        if ($snapshot.Exists) {
            $rollbackPath = Resolve-ContainedPath `
                $rollbackRoot `
                $snapshot.File.Target `
                'Rollback target'
            New-Item -ItemType Directory -Path (Split-Path -Parent $rollbackPath) -Force |
                Out-Null
            Copy-Item -LiteralPath $snapshot.TargetPath -Destination $rollbackPath -Force
            if ($null -ne $persistentBackupRoot) {
                $backupPath = Resolve-ContainedPath `
                    $persistentBackupRoot `
                    $snapshot.File.Target `
                    'Upgrade backup target'
                New-Item -ItemType Directory -Path (Split-Path -Parent $backupPath) -Force |
                    Out-Null
                Copy-Item -LiteralPath $snapshot.TargetPath -Destination $backupPath -Force
            }
        }
        else {
            $newTargetPaths.Add($snapshot.TargetPath)
        }
    }

    foreach ($stale in $staleMarkerFiles) {
        $targetPath = Resolve-ContainedPath $projectRoot $stale.Target 'Stale target'
        $exists = Test-Path -LiteralPath $targetPath -PathType Leaf
        $originalTargets[$stale.Target] = $exists
        if (-not $exists) {
            continue
        }
        $rollbackPath = Resolve-ContainedPath $rollbackRoot $stale.Target 'Stale rollback target'
        New-Item -ItemType Directory -Path (Split-Path -Parent $rollbackPath) -Force |
            Out-Null
        Copy-Item -LiteralPath $targetPath -Destination $rollbackPath -Force
        if ($null -ne $persistentBackupRoot) {
            $backupPath = Resolve-ContainedPath `
                $persistentBackupRoot `
                $stale.Target `
                'Stale upgrade backup target'
            New-Item -ItemType Directory -Path (Split-Path -Parent $backupPath) -Force |
                Out-Null
            Copy-Item -LiteralPath $targetPath -Destination $backupPath -Force
        }
    }

    if (Test-Path -LiteralPath $markerPath -PathType Leaf) {
        Copy-Item -LiteralPath $markerPath -Destination $markerBackup -Force
    }

    foreach ($snapshot in $changes) {
        $stagePath = Resolve-ContainedPath $stageRoot $snapshot.File.Target 'Staged target'
        New-Item -ItemType Directory -Path (Split-Path -Parent $snapshot.TargetPath) -Force |
            Out-Null
        Copy-Item -LiteralPath $stagePath -Destination $snapshot.TargetPath -Force
        if ((Get-FileSha256 $snapshot.TargetPath) -ne $snapshot.File.Sha256) {
            throw "Installed payload verification failed for $($snapshot.File.Target)."
        }
    }

    $removedPaths = [System.Collections.Generic.List[string]]::new()
    foreach ($stale in $staleMarkerFiles) {
        $targetPath = Resolve-ContainedPath $projectRoot $stale.Target 'Stale target'
        if (Test-Path -LiteralPath $targetPath -PathType Leaf) {
            Remove-Item -LiteralPath $targetPath -Force
            $removedPaths.Add($targetPath)
        }
    }
    if ($removedPaths.Count -gt 0) {
        Remove-EmptyInstallParents $projectRoot @($removedPaths)
    }

    $markerDocument = [ordered]@{
        schemaVersion = 1
        pluginID = $context.PluginID
        version = $context.Version
        installedAt = [DateTime]::UtcNow.ToString('o')
        backupPath = $persistentBackupRelative
        files = @(
            $context.Files | ForEach-Object {
                [ordered]@{
                    target = $_.Target
                    sha256 = $_.Sha256
                    size = $_.Size
                }
            }
        )
    }
    Write-JsonDocumentAtomically $markerPath $markerDocument
}
catch {
    foreach ($entry in $originalTargets.GetEnumerator()) {
        $targetPath = Resolve-ContainedPath $projectRoot $entry.Key 'Rollback destination'
        $rollbackPath = Resolve-ContainedPath $rollbackRoot $entry.Key 'Rollback source'
        if ($entry.Value -and (Test-Path -LiteralPath $rollbackPath -PathType Leaf)) {
            New-Item -ItemType Directory -Path (Split-Path -Parent $targetPath) -Force |
                Out-Null
            Copy-Item -LiteralPath $rollbackPath -Destination $targetPath -Force
        }
        elseif (-not $entry.Value -and (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
            Remove-Item -LiteralPath $targetPath -Force
        }
    }
    if (Test-Path -LiteralPath $markerBackup -PathType Leaf) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $markerPath) -Force |
            Out-Null
        Copy-Item -LiteralPath $markerBackup -Destination $markerPath -Force
    }
    elseif (Test-Path -LiteralPath $markerPath -PathType Leaf) {
        Remove-Item -LiteralPath $markerPath -Force
    }
    if ($null -ne $persistentBackupRoot -and (Test-Path -LiteralPath $persistentBackupRoot)) {
        Remove-Item -LiteralPath $persistentBackupRoot -Recurse -Force
    }
    throw
}
finally {
    if (Test-Path -LiteralPath $transactionRoot -PathType Container) {
        Remove-Item -LiteralPath $transactionRoot -Recurse -Force
    }
}

New-InstallResult 'installed' $true $persistentBackupRelative |
    ConvertTo-Json -Depth 16

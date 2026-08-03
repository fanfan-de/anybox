Set-StrictMode -Version Latest

$script:GodotCliPackageScriptRoot = $PSScriptRoot
$script:GodotCliPluginID = 'godot-cli'
$script:GodotCliInstallMarker = '.godot-cli/anybox-install.json'

function ConvertTo-SafeRelativePath {
    param(
        [Parameter(Mandatory)]
        [string]$Value,

        [Parameter(Mandatory)]
        [string]$Label
    )

    $trimmed = $Value.Trim().Replace('\', '/')
    if (
        [string]::IsNullOrWhiteSpace($trimmed) -or
        [System.IO.Path]::IsPathRooted($trimmed) -or
        $trimmed.StartsWith('/') -or
        $trimmed -match '(^|/)\.\.(/|$)' -or
        $trimmed -match '(^|/)\.(/|$)' -or
        $trimmed.IndexOf([char]0) -ge 0
    ) {
        throw "$Label must be a safe package-relative path."
    }
    return $trimmed
}

function Resolve-ContainedPath {
    param(
        [Parameter(Mandatory)]
        [string]$Root,

        [Parameter(Mandatory)]
        [string]$RelativePath,

        [Parameter(Mandatory)]
        [string]$Label
    )

    $safeRelative = ConvertTo-SafeRelativePath $RelativePath $Label
    $resolvedRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
    $nativeRelative = $safeRelative.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    $resolvedPath = [System.IO.Path]::GetFullPath((Join-Path $resolvedRoot $nativeRelative))
    $rootPrefix = $resolvedRoot + [System.IO.Path]::DirectorySeparatorChar
    if (
        -not $resolvedPath.StartsWith(
            $rootPrefix,
            [System.StringComparison]::OrdinalIgnoreCase
        )
    ) {
        throw "$Label escapes its allowed root."
    }
    return $resolvedPath
}

function Get-FileSha256 {
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Read-JsonDocument {
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [Parameter(Mandatory)]
        [string]$Label
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label is missing at $Path."
    }
    try {
        return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json -Depth 64
    }
    catch {
        throw "$Label is not valid JSON: $($_.Exception.Message)"
    }
}

function Get-GodotCliPackageContext {
    $pluginRoot = [System.IO.Path]::GetFullPath(
        (Join-Path $script:GodotCliPackageScriptRoot '..')
    )
    $pluginManifestPath = Join-Path $pluginRoot '.anybox-plugin\plugin.json'
    $payloadRoot = Join-Path $pluginRoot 'payload'
    $payloadManifestPath = Join-Path $payloadRoot 'SHA256SUMS.json'
    $pluginManifest = Read-JsonDocument $pluginManifestPath 'Anybox plugin manifest'
    $payloadManifest = Read-JsonDocument $payloadManifestPath 'Payload manifest'

    if ($pluginManifest.name -ne $script:GodotCliPluginID) {
        throw "Anybox plugin manifest name must be '$script:GodotCliPluginID'."
    }
    if ($payloadManifest.schemaVersion -ne 1) {
        throw 'Payload manifest schemaVersion must be 1.'
    }
    if ($payloadManifest.pluginID -ne $script:GodotCliPluginID) {
        throw "Payload manifest pluginID must be '$script:GodotCliPluginID'."
    }
    if ($payloadManifest.version -ne $pluginManifest.version) {
        throw 'Payload and Anybox plugin manifest versions do not match.'
    }

    $files = @($payloadManifest.files)
    if ($files.Count -lt 2) {
        throw 'Payload manifest must contain the addon and CLI files.'
    }
    $targets = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )
    $validatedFiles = foreach ($file in $files) {
        $source = ConvertTo-SafeRelativePath ([string]$file.source) 'Payload source'
        $target = ConvertTo-SafeRelativePath ([string]$file.target) 'Payload target'
        $sha256 = ([string]$file.sha256).ToLowerInvariant()
        $size = [long]$file.size
        if ($sha256 -notmatch '^[a-f0-9]{64}$') {
            throw "Payload SHA-256 is invalid for $source."
        }
        if ($size -lt 0) {
            throw "Payload size is invalid for $source."
        }
        if (-not $targets.Add($target)) {
            throw "Payload target is duplicated: $target."
        }

        $sourcePath = Resolve-ContainedPath $payloadRoot $source 'Payload source'
        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
            throw "Payload source is missing: $source."
        }
        $sourceFile = Get-Item -LiteralPath $sourcePath
        if ($sourceFile.Length -ne $size) {
            throw "Payload size mismatch for $source."
        }
        if ((Get-FileSha256 $sourcePath) -ne $sha256) {
            throw "Payload SHA-256 mismatch for $source."
        }

        [pscustomobject]@{
            Source = $source
            Target = $target
            Sha256 = $sha256
            Size = $size
            SourcePath = $sourcePath
        }
    }

    return [pscustomobject]@{
        PluginID = $script:GodotCliPluginID
        Version = [string]$pluginManifest.version
        PluginRoot = $pluginRoot
        PayloadRoot = $payloadRoot
        Files = @($validatedFiles)
    }
}

function Resolve-GodotProjectRoot {
    param(
        [Parameter(Mandatory)]
        [string]$ProjectPath
    )

    if (-not (Test-Path -LiteralPath $ProjectPath -PathType Container)) {
        throw "Godot project directory does not exist: $ProjectPath."
    }
    $projectRoot = (Resolve-Path -LiteralPath $ProjectPath).Path
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'project.godot') -PathType Leaf)) {
        throw "No project.godot exists in $projectRoot."
    }
    return $projectRoot
}

function Get-InstallMarkerPath {
    param(
        [Parameter(Mandatory)]
        [string]$ProjectRoot
    )

    return Resolve-ContainedPath $ProjectRoot $script:GodotCliInstallMarker 'Install marker'
}

function Read-InstallMarker {
    param(
        [Parameter(Mandatory)]
        [string]$ProjectRoot
    )

    $markerPath = Get-InstallMarkerPath $ProjectRoot
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
        return $null
    }
    $marker = Read-JsonDocument $markerPath 'Godot CLI install marker'
    if ($marker.schemaVersion -ne 1 -or $marker.pluginID -ne $script:GodotCliPluginID) {
        throw 'Godot CLI install marker is not owned by this plugin.'
    }
    return $marker
}

function Get-TargetSnapshot {
    param(
        [Parameter(Mandatory)]
        [string]$ProjectRoot,

        [Parameter(Mandatory)]
        [object]$File
    )

    $targetPath = Resolve-ContainedPath $ProjectRoot $File.Target 'Install target'
    $exists = Test-Path -LiteralPath $targetPath -PathType Leaf
    $sha256 = if ($exists) { Get-FileSha256 $targetPath } else { $null }
    $size = if ($exists) { (Get-Item -LiteralPath $targetPath).Length } else { $null }
    return [pscustomobject]@{
        File = $File
        TargetPath = $targetPath
        Exists = $exists
        Sha256 = $sha256
        Size = $size
        MatchesPayload = $exists -and $sha256 -eq $File.Sha256 -and $size -eq $File.Size
    }
}

function Write-JsonDocumentAtomically {
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [Parameter(Mandatory)]
        [object]$Value
    )

    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $temporaryPath = "$Path.$PID.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        $Value |
            ConvertTo-Json -Depth 64 |
            Set-Content -LiteralPath $temporaryPath -Encoding utf8NoBOM
        Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

function Remove-EmptyInstallParents {
    param(
        [Parameter(Mandatory)]
        [string]$ProjectRoot,

        [Parameter(Mandatory)]
        [string[]]$Paths
    )

    $resolvedProject = [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
    $directories = @(
        $Paths |
            ForEach-Object { Split-Path -Parent $_ } |
            Sort-Object Length -Descending -Unique
    )
    foreach ($directory in $directories) {
        $current = $directory
        while (
            -not [string]::IsNullOrWhiteSpace($current) -and
            $current -ne $resolvedProject -and
            $current.StartsWith(
                $resolvedProject + '\',
                [System.StringComparison]::OrdinalIgnoreCase
            )
        ) {
            if (-not (Test-Path -LiteralPath $current -PathType Container)) {
                $current = Split-Path -Parent $current
                continue
            }
            $children = @(Get-ChildItem -LiteralPath $current -Force)
            if ($children.Count -gt 0) {
                break
            }
            Remove-Item -LiteralPath $current -Force
            $current = Split-Path -Parent $current
        }
    }
}

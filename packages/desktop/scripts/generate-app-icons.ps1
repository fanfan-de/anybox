param(
  [string]$SourceSvg,
  [string]$OutputDir,
  [int]$PngSize = 512
)

$ErrorActionPreference = "Stop"

$projectDir = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $OutputDir) {
  $OutputDir = Join-Path $projectDir "build"
}

if (-not $SourceSvg) {
  $publicDir = Join-Path $projectDir "src\renderer\public"
  $whiteCharacter = [char]0x767D
  $SourceSvg = (Get-ChildItem -LiteralPath $publicDir -Filter "*.svg" |
    Where-Object { $_.BaseName.Contains($whiteCharacter) } |
    Select-Object -First 1).FullName
}

if (-not $SourceSvg -or -not (Test-Path -LiteralPath $SourceSvg)) {
  throw "[desktop][icons] source SVG not found: $SourceSvg"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

try {
  Add-Type -AssemblyName System.Drawing
} catch {
  Add-Type -AssemblyName System.Drawing.Common
}

function Get-AttributeValue($tag, $name) {
  $match = [regex]::Match($tag, "$name\s*=\s*`"([^`"]+)`"")
  if (-not $match.Success) {
    throw "[desktop][icons] missing SVG image attribute: $name"
  }
  return [double]::Parse($match.Groups[1].Value, [Globalization.CultureInfo]::InvariantCulture)
}

function New-TransparentBitmap($width, $height) {
  $bitmap = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.Dispose()
  return $bitmap
}

function Draw-ImageHighQuality($target, $source, $rectangle) {
  $graphics = [System.Drawing.Graphics]::FromImage($target)
  $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.DrawImage($source, $rectangle)
  $graphics.Dispose()
}

function Convert-BitmapToPngBytes($bitmap) {
  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $stream.ToArray()
  $stream.Dispose()
  return $bytes
}

function New-ResizedPngBytes($source, $size) {
  $bitmap = New-TransparentBitmap $size $size
  Draw-ImageHighQuality $bitmap $source (New-Object System.Drawing.Rectangle(0, 0, $size, $size))
  try {
    return Convert-BitmapToPngBytes $bitmap
  } finally {
    $bitmap.Dispose()
  }
}

function Get-IcoDimensionByte($size) {
  if ($size -eq 256) {
    return [byte]0
  }
  return [byte]$size
}

function Write-Ico($path, [int[]]$sizes, [byte[][]]$frames) {
  $stream = New-Object System.IO.MemoryStream
  $writer = New-Object System.IO.BinaryWriter($stream)
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]$sizes.Length)

  $offset = 6 + (16 * $sizes.Length)
  for ($index = 0; $index -lt $sizes.Length; $index++) {
    $writer.Write((Get-IcoDimensionByte $sizes[$index]))
    $writer.Write((Get-IcoDimensionByte $sizes[$index]))
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$frames[$index].Length)
    $writer.Write([UInt32]$offset)
    $offset += $frames[$index].Length
  }

  foreach ($frame in $frames) {
    $writer.Write($frame)
  }

  [System.IO.File]::WriteAllBytes($path, $stream.ToArray())
  $writer.Dispose()
  $stream.Dispose()
}

$svg = Get-Content -LiteralPath $SourceSvg -Raw -Encoding UTF8
$viewBoxMatch = [regex]::Match($svg, 'viewBox\s*=\s*"([^"]+)"')
if (-not $viewBoxMatch.Success) {
  throw "[desktop][icons] source SVG has no viewBox: $SourceSvg"
}

$viewBox = $viewBoxMatch.Groups[1].Value -split '[,\s]+' | Where-Object { $_ -ne "" }
if ($viewBox.Length -ne 4) {
  throw "[desktop][icons] unsupported SVG viewBox: $($viewBoxMatch.Groups[1].Value)"
}

$viewWidth = [int][Math]::Round([double]::Parse($viewBox[2], [Globalization.CultureInfo]::InvariantCulture))
$viewHeight = [int][Math]::Round([double]::Parse($viewBox[3], [Globalization.CultureInfo]::InvariantCulture))

$imageTagMatch = [regex]::Match($svg, '<image\b[^>]*>', [Text.RegularExpressions.RegexOptions]::Singleline)
if (-not $imageTagMatch.Success) {
  throw "[desktop][icons] source SVG has no embedded image: $SourceSvg"
}

$imageTag = $imageTagMatch.Value
$imageX = [int][Math]::Round((Get-AttributeValue $imageTag "x"))
$imageY = [int][Math]::Round((Get-AttributeValue $imageTag "y"))
$imageWidth = [int][Math]::Round((Get-AttributeValue $imageTag "width"))
$imageHeight = [int][Math]::Round((Get-AttributeValue $imageTag "height"))

$base64Match = [regex]::Match($svg, 'base64,([A-Za-z0-9+/=]+)')
if (-not $base64Match.Success) {
  throw "[desktop][icons] source SVG has no embedded base64 PNG: $SourceSvg"
}

$embeddedPngBytes = [Convert]::FromBase64String($base64Match.Groups[1].Value)
$embeddedStream = New-Object System.IO.MemoryStream(,$embeddedPngBytes)
$embeddedImage = [System.Drawing.Image]::FromStream($embeddedStream)

$canvas = New-TransparentBitmap $viewWidth $viewHeight
Draw-ImageHighQuality $canvas $embeddedImage (New-Object System.Drawing.Rectangle($imageX, $imageY, $imageWidth, $imageHeight))

$squareSize = [Math]::Max($viewWidth, $viewHeight)
$square = New-TransparentBitmap $squareSize $squareSize
$offsetX = [int][Math]::Floor(($squareSize - $viewWidth) / 2)
$offsetY = [int][Math]::Floor(($squareSize - $viewHeight) / 2)
Draw-ImageHighQuality $square $canvas (New-Object System.Drawing.Rectangle($offsetX, $offsetY, $viewWidth, $viewHeight))

$iconSvgPath = Join-Path $OutputDir "icon.svg"
$iconPngPath = Join-Path $OutputDir "icon.png"
$iconMasterPath = Join-Path $OutputDir "icon-master.png"
$iconIcoPath = Join-Path $OutputDir "icon.ico"
$installerIcoPath = Join-Path $OutputDir "installerIcon.ico"
$trayTemplatePngPath = Join-Path $OutputDir "trayTemplate.png"
$trayTemplate2xPngPath = Join-Path $OutputDir "trayTemplate@2x.png"

Copy-Item -LiteralPath $SourceSvg -Destination $iconSvgPath -Force
[System.IO.File]::WriteAllBytes($iconPngPath, (New-ResizedPngBytes $square $PngSize))
[System.IO.File]::WriteAllBytes($iconMasterPath, (New-ResizedPngBytes $square 1024))
[System.IO.File]::WriteAllBytes($trayTemplatePngPath, (New-ResizedPngBytes $square 18))
[System.IO.File]::WriteAllBytes($trayTemplate2xPngPath, (New-ResizedPngBytes $square 36))

$icoSizes = @(16, 24, 32, 48, 64, 128, 256)
$icoFrames = @()
foreach ($size in $icoSizes) {
  $icoFrames += ,(New-ResizedPngBytes $square $size)
}

Write-Ico $iconIcoPath $icoSizes $icoFrames
Copy-Item -LiteralPath $iconIcoPath -Destination $installerIcoPath -Force

$embeddedImage.Dispose()
$embeddedStream.Dispose()
$canvas.Dispose()
$square.Dispose()

Write-Host "[desktop][icons] generated app icons from $SourceSvg"

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
$outputDir = Join-Path $repoRoot "icons"
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

function Add-RoundedRectangle {
  param(
    [System.Drawing.Drawing2D.GraphicsPath]$Path,
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $diameter = $Radius * 2
  $Path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $Path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $Path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $Path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $Path.CloseFigure()
}

function New-StatusIcon {
  param(
    [int]$Size,
    [string]$Name,
    [string]$BackgroundColor,
    [ValidateSet("check", "cross")]
    [string]$Symbol
  )

  $bitmap = [System.Drawing.Bitmap]::new(
    $Size,
    $Size,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $inset = [float]($Size * 0.04)
  $side = [float]($Size - 2 * $inset)
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  Add-RoundedRectangle $path $inset $inset $side $side ([float]($Size * 0.19))
  $background = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($BackgroundColor))
  $graphics.FillPath($background, $path)

  $symbolPen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, [float]($Size * 0.095))
  $symbolPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $symbolPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $symbolPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  if ($Symbol -eq "check") {
    $graphics.DrawLines($symbolPen, [System.Drawing.PointF[]]@(
      [System.Drawing.PointF]::new([float]($Size * 0.25), [float]($Size * 0.53)),
      [System.Drawing.PointF]::new([float]($Size * 0.43), [float]($Size * 0.70)),
      [System.Drawing.PointF]::new([float]($Size * 0.76), [float]($Size * 0.34))
    ))
  } else {
    $graphics.DrawLine($symbolPen, [float]($Size * 0.31), [float]($Size * 0.31), [float]($Size * 0.69), [float]($Size * 0.69))
    $graphics.DrawLine($symbolPen, [float]($Size * 0.69), [float]($Size * 0.31), [float]($Size * 0.31), [float]($Size * 0.69))
  }

  $path.Dispose()
  $background.Dispose()
  $symbolPen.Dispose()
  $graphics.Dispose()
  $target = Join-Path $outputDir "$Name.png"
  $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
}

function New-ExtensionIcon {
  param([int]$Size)

  $masterPath = Join-Path $repoRoot "assets\extension-icon-master.png"
  $master = [System.Drawing.Image]::FromFile($masterPath)
  $bitmap = [System.Drawing.Bitmap]::new(
    $Size,
    $Size,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.DrawImage($master, 0, 0, $Size, $Size)
  $graphics.Dispose()
  $master.Dispose()
  $target = Join-Path $outputDir "icon$Size.png"
  $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
}

16, 32, 48, 128 | ForEach-Object {
  New-ExtensionIcon -Size $_
}
New-StatusIcon -Size 128 -Name "pipeline-passed128" -BackgroundColor "#16A34A" -Symbol "check"
New-StatusIcon -Size 128 -Name "pipeline-failed128" -BackgroundColor "#DC2626" -Symbol "cross"

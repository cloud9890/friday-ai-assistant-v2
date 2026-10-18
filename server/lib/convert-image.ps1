# F.R.I.D.A.Y. // helper — convert one image between formats.
# Invoked argv-only by server/skills/convert_image.js:
#   powershell -File convert-image.ps1 -Source <path> -Dest <path> -Format <png|jpg|bmp>
# The caller owns policy; this script only converts what it is handed.
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Dest,
  [Parameter(Mandatory = $true)][string]$Format
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$target = switch ($Format.ToLower()) {
  'png' { [System.Drawing.Imaging.ImageFormat]::Png }
  'jpg' { [System.Drawing.Imaging.ImageFormat]::Jpeg }
  'jpeg' { [System.Drawing.Imaging.ImageFormat]::Jpeg }
  'bmp' { [System.Drawing.Imaging.ImageFormat]::Bmp }
  default { throw "unsupported format: $Format" }
}

# GDI+ refuses to re-encode some loaded images directly ("A generic error
# occurred in GDI+"), so the pixels are redrawn into a fresh bitmap first.
$image = [System.Drawing.Image]::FromFile($Source)
$canvas = New-Object System.Drawing.Bitmap $image.Width, $image.Height
try {
  $graphics = [System.Drawing.Graphics]::FromImage($canvas)
  $graphics.DrawImage($image, 0, 0, $image.Width, $image.Height)
  $graphics.Dispose()
  $canvas.Save($Dest, $target)
  Write-Output "converted $Source -> $Dest"
} finally {
  $canvas.Dispose()
  $image.Dispose()
}

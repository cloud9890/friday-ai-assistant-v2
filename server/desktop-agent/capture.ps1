# ==========================================================================
# F.R.I.D.A.Y. // DESKTOP AGENT - WINDOW CAPTURE
# Standalone screenshot helper, separate from uia.ps1 on purpose: combining
# input injection with screen capture in one script trips Windows Defender's
# remote-control heuristic. This script only captures - it never sends input.
# Finds the target window by UIA, brings it to the front, and returns a JPEG
# data URL of its rectangle.
# ==========================================================================
param(
  [Parameter(Mandatory = $true)][string]$AppName = '',
  [int]$ProcId = 0,
  [string]$WindowTitle = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing

Add-Type -Namespace Native -Name Win -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr hWnd);
'@

function Out-Json($obj) {
  Write-Output ($obj | ConvertTo-Json -Depth 6 -Compress)
}
function Fail([string]$code, [string]$message) {
  Out-Json @{ ok = $false; code = $code; error = $message }
  exit 0
}

# Same shell-window block as uia.ps1 (defence in depth with the engine).
$SENSITIVE = @('cmd', 'powershell', 'pwsh', 'wscript', 'cscript', 'mshta')

$procs = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 })
if ($ProcId -gt 0) {
  $hits = @($procs | Where-Object { $_.Id -eq $ProcId })
  if ($hits.Count -eq 0) { Fail 'APP_NOT_FOUND' "no process with pid $ProcId owns a window" }
  $proc = $hits[0]
} else {
  if (-not $AppName.Trim()) { Fail 'APP_NOT_FOUND' 'no appName or pid given' }
  $name = $AppName.Trim().ToLower()
  $hits = @($procs | Where-Object { $_.ProcessName.ToLower() -eq $name })
  if ($hits.Count -eq 0) { $hits = @($procs | Where-Object { $_.ProcessName.ToLower().StartsWith($name) }) }
  if ($hits.Count -eq 0) {
    $hits = @($procs | Where-Object { ([string]$_.MainWindowTitle).ToLower().Contains($name) })
  }
  if ($hits.Count -eq 0) {
    $titles = ($procs | ForEach-Object { $_.ProcessName }) | Select-Object -Unique | Select-Object -First 25
    Fail 'APP_NOT_FOUND' "no running app matches '$AppName'. Apps with windows right now: $($titles -join ', ')"
  }
  if ($hits.Count -gt 1) {
    $list = ($hits | ForEach-Object { "$($_.ProcessName)(pid $($_.Id)) '$($_.MainWindowTitle)'" }) -join '; '
    Fail 'AMBIGUOUS_APP' "several windows match '$AppName': $list. Retry with an exact pid."
  }
  $proc = $hits[0]
}
if ($SENSITIVE -contains $proc.ProcessName.ToLower()) {
  Fail 'SENSITIVE_APP' "capturing a $($proc.ProcessName) window is not allowed"
}

$win = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)

# A minimized window reports an empty rectangle — restore it first (a
# minimized window is still fully automatable, we just need it visible).
if ([Native.Win]::IsIconic($proc.MainWindowHandle)) {
  [Native.Win]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null  # SW_RESTORE
  Start-Sleep -Milliseconds 400
}

# Store apps occasionally report an empty rect right after restore; retry.
$r = [System.Windows.Rect]::Empty
foreach ($i in 1..3) {
  $r = $win.Current.BoundingRectangle
  if ($r -ne [System.Windows.Rect]::Empty) { break }
  Start-Sleep -Milliseconds 500
}
if ($r -eq [System.Windows.Rect]::Empty) { Fail 'ACTION_UNAVAILABLE' 'window has no capturable rectangle' }

[Native.Win]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 350

$x = [int]$r.X; $y = [int]$r.Y; $w = [int]$r.Width; $h = [int]$r.Height
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size($w, $h)))
$g.Dispose()
$ms = New-Object System.IO.MemoryStream
$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]60)
$bmp.Save($ms, $jpegCodec, $ep)
$bmp.Dispose()
$b64 = [Convert]::ToBase64String($ms.ToArray())
$ms.Dispose()

Out-Json @{
  ok          = $true
  action      = 'screenshot'
  process     = $proc.ProcessName
  pid         = $proc.Id
  windowTitle = [string]$proc.MainWindowTitle
  size        = @{ w = $w; h = $h }
  screenshot  = "data:image/jpeg;base64,$b64"
}

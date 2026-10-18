# ==========================================================================
# F.R.I.D.A.Y. // DESKTOP AGENT - UIA BRIDGE (Windows UI Automation)
# Accessibility-first native app control, ported from the computer-use skill:
# observe a window's semantic tree, act on elements by index, verify effects.
# One invocation = one action. Output is a single JSON object on stdout;
# failures are structured ({ok:false, code, error}) and fail closed.
# ==========================================================================
param(
  [Parameter(Mandatory = $true)][string]$Action,
  [string]$AppName = '',
  [int]$ProcId = 0,
  [string]$WindowTitle = '',
  [int]$Index = -1,
  [string]$Text = '',
  [string]$Key = '',
  [string]$Direction = 'down',
  [string]$ActionName = '',
  [string]$Query = '',
  [int]$MaxElements = 120
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -Namespace Native -Name Mouse -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, System.UIntPtr extra);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
'@

# Never automate a shell window: typing there is arbitrary command execution.
$SENSITIVE = @('cmd', 'powershell', 'pwsh', 'wscript', 'cscript', 'mshta')

function Out-Json($obj) {
  Write-Output ($obj | ConvertTo-Json -Depth 6 -Compress)
}
function Fail([string]$code, [string]$message, [bool]$sent = $false) {
  Out-Json @{ ok = $false; code = $code; error = $message; actionSent = $sent }
  exit 0
}

function Escape-SendKeys([string]$s) {
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $s.ToCharArray()) {
    switch ($ch) {
      '+' { [void]$sb.Append('{+}') }
      '^' { [void]$sb.Append('{^}') }
      '%' { [void]$sb.Append('{%}') }
      '~' { [void]$sb.Append('{~}') }
      '(' { [void]$sb.Append('{(}') }
      ')' { [void]$sb.Append('{)}') }
      '{' { [void]$sb.Append('{{}') }
      '}' { [void]$sb.Append('{}}') }
      '[' { [void]$sb.Append('{[}') }
      ']' { [void]$sb.Append('{]}') }
      default { [void]$sb.Append($ch) }
    }
  }
  $sb.ToString()
}

# "ctrl+alt+F4" -> "^%{F4}", "shift+Tab" -> "+{TAB}", "a" -> "a"
function Convert-Key([string]$key) {
  $map = @{
    enter = '{ENTER}'; return = '{ENTER}'; tab = '{TAB}'; escape = '{ESC}'; esc = '{ESC}';
    backspace = '{BS}'; delete = '{DEL}'; del = '{DEL}'; space = ' ';
    up = '{UP}'; down = '{DOWN}'; left = '{LEFT}'; right = '{RIGHT}';
    home = '{HOME}'; end = '{END}'; pageup = '{PGUP}'; pagedown = '{PGDN}';
    insert = '{INS}'
  }
  $mods = ''
  $main = ''
  foreach ($part in ($key.Split('+') | Where-Object { $_ -ne '' })) {
    $p = $part.ToLower()
    if ($p -eq 'ctrl' -or $p -eq 'control') { $mods += '^' }
    elseif ($p -eq 'alt') { $mods += '%' }
    elseif ($p -eq 'shift') { $mods += '+' }
    else { $main = $part }
  }
  if (-not $main) { throw 'no main key in chord' }
  $lower = $main.ToLower()
  if ($map.ContainsKey($lower)) { return $mods + $map[$lower] }
  if ($lower -match '^f([1-9]|1[0-2])$') { return $mods + ('{F' + $Matches[1] + '}') }
  if ($main.Length -eq 1) { return $mods + $main }
  throw "unsupported key: $key"
}

# Pattern objects resolved once at load (type literals cannot interpolate).
$PATTERNS = @{
  Invoke         = [System.Windows.Automation.InvokePattern]::Pattern
  Value          = [System.Windows.Automation.ValuePattern]::Pattern
  Toggle         = [System.Windows.Automation.TogglePattern]::Pattern
  SelectionItem  = [System.Windows.Automation.SelectionItemPattern]::Pattern
  ExpandCollapse = [System.Windows.Automation.ExpandCollapsePattern]::Pattern
  ScrollItem     = [System.Windows.Automation.ScrollItemPattern]::Pattern
}

function Get-SupportedPatterns($el) {
  $found = @()
  foreach ($name in $PATTERNS.Keys) {
    $pobj = $null
    try {
      if ($el.TryGetCurrentPattern($PATTERNS[$name], [ref]$pobj)) { $found += $name }
    } catch {}
  }
  return $found
}

function Get-ElementValue($el) {
  try {
    $vp = $null
    if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
      if ($vp.Current.IsPassword) { return '' }
      $v = [string]$vp.Current.Value
      if ($v.Length -gt 80) { return $v.Substring(0, 80) }
      return $v
    }
  } catch {}
  return ''
}

function Get-RectJson($el) {
  try {
    $r = $el.Current.BoundingRectangle
    if ($r -eq [System.Windows.Rect]::Empty) { return $null }
    return @{ x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height }
  } catch { return $null }
}

$script:walked = New-Object System.Collections.ArrayList

function Walk([System.Windows.Automation.AutomationElement]$el, [int]$depth) {
  if ($script:walked.Count -ge $MaxElements) { return }
  $role = ''
  try { $role = $el.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '' } catch { $role = 'Unknown' }
  $info = [ordered]@{
    index        = $script:walked.Count
    role         = $role
    name         = [string]$el.Current.Name
    value        = Get-ElementValue $el
    automationId = [string]$el.Current.AutomationId
    enabled      = [bool]$el.Current.IsEnabled
    focused      = [bool]$el.Current.HasKeyboardFocus
    offscreen    = [bool]$el.Current.IsOffscreen
    rect         = Get-RectJson $el
    patterns     = @(Get-SupportedPatterns $el)
  }
  [void]$script:walked.Add(@{ el = $el; info = $info })
  if ($depth -ge 8) { return }
  try {
    $kids = $el.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($k in $kids) { Walk $k ($depth + 1) }
  } catch {}
}

function Find-TargetProcess {
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
  if ($WindowTitle.Trim()) {
    $wt = $WindowTitle.Trim().ToLower()
    if (-not ([string]$proc.MainWindowTitle).ToLower().Contains($wt)) {
      Fail 'APP_NOT_FOUND' "process $($proc.ProcessName) has no window titled like '$WindowTitle' (actual: '$($proc.MainWindowTitle)')"
    }
  }
  if ($SENSITIVE -contains $proc.ProcessName.ToLower()) {
    Fail 'SENSITIVE_APP' "automating a $($proc.ProcessName) window is not allowed"
  }
  return $proc
}

function Get-WindowElement($proc) {
  return [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
}

function Get-ElementByIndex($proc, [int]$idx) {
  $win = Get-WindowElement $proc
  $script:walked = New-Object System.Collections.ArrayList
  Walk $win 0
  if ($idx -lt 0 -or $idx -ge $script:walked.Count) {
    Fail 'ELEMENT_UNAVAILABLE' "index $idx is outside the current tree (0..$($script:walked.Count - 1)). Observe the app again - the tree may have changed."
  }
  return $script:walked[$idx]
}

function Get-FocusedInfo {
  try {
    $f = [System.Windows.Automation.AutomationElement]::FocusedElement
    $role = $f.Current.ControlType.ProgrammaticName -replace '^ControlType\.', ''
    return @{ role = $role; name = [string]$f.Current.Name }
  } catch { return @{ role = ''; name = '' } }
}

# ------------------------------- dispatch ---------------------------------
switch ($Action) {

  'listApps' {
    $apps = @()
    foreach ($p in (Get-Process | Where-Object { $_.MainWindowHandle -ne 0 })) {
      $apps += [ordered]@{
        process    = $p.ProcessName
        pid        = $p.Id
        title      = [string]$p.MainWindowTitle
        sensitive  = ($SENSITIVE -contains $p.ProcessName.ToLower())
      }
    }
    Out-Json @{ ok = $true; action = 'listApps'; apps = $apps }
    exit 0
  }

  'observe' {
    $proc = Find-TargetProcess
    $win = Get-WindowElement $proc
    $script:walked = New-Object System.Collections.ArrayList
    Walk $win 0
    $list = @()
    $q = $Query.Trim().ToLower()
    foreach ($w in $script:walked) {
      if ($q -and -not (($w.info.name + ' ' + $w.info.role + ' ' + $w.info.value).ToLower().Contains($q))) { continue }
      $list += $w.info
    }
    Out-Json @{
      ok          = $true
      action      = 'observe'
      process     = $proc.ProcessName
      pid         = $proc.Id
      windowTitle = [string]$proc.MainWindowTitle
      treeCount   = $script:walked.Count
      listed      = $list.Count
      elements    = $list
    }
    exit 0
  }

  'click' {
    $proc = Find-TargetProcess
    $entry = Get-ElementByIndex $proc $Index
    $el = $entry.el
    $how = ''
    try {
      $p = $null
      if ($el.TryGetCurrentPattern($PATTERNS.Invoke, [ref]$p)) { $p.Invoke(); $how = 'invoke' }
    } catch {}
    if (-not $how) {
      try {
        $p = $null
        if ($el.TryGetCurrentPattern($PATTERNS.SelectionItem, [ref]$p)) { $p.Select(); $how = 'select' }
      } catch {}
    }
    if (-not $how) {
      try {
        $p = $null
        if ($el.TryGetCurrentPattern($PATTERNS.Toggle, [ref]$p)) { $p.Toggle(); $how = 'toggle' }
      } catch {}
    }
    if (-not $how) {
      # Pattern-less target: real pointer click at its location. Foreground the
      # window first so screen coordinates land on THIS window.
      [Native.Mouse]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
      Start-Sleep -Milliseconds 250
      $r = $el.Current.BoundingRectangle
      if ($r -eq [System.Windows.Rect]::Empty) { Fail 'ACTION_UNAVAILABLE' 'element has no clickable area and no supported pattern' }
      $x = [int]($r.X + $r.Width / 2); $y = [int]($r.Y + $r.Height / 2)
      [Native.Mouse]::SetCursorPos($x, $y) | Out-Null
      Start-Sleep -Milliseconds 80
      [Native.Mouse]::mouse_event(0x0002, 0, 0, 0, [System.UIntPtr]::Zero)  # LEFTDOWN
      [Native.Mouse]::mouse_event(0x0004, 0, 0, 0, [System.UIntPtr]::Zero)  # LEFTUP
      $how = 'coordinate-click'
      Start-Sleep -Milliseconds 400
    } else {
      Start-Sleep -Milliseconds 400
    }
    Out-Json @{
      ok           = $true
      action       = 'click'
      via          = $how
      target       = $entry.info
      pid          = $proc.Id
      process      = $proc.ProcessName
      windowTitle  = [string]$proc.MainWindowTitle
      focusedAfter = Get-FocusedInfo
    }
    exit 0
  }

  'setValue' {
    if (-not $Text) { Fail 'INVALID_ARGUMENT' 'no text given' }
    $proc = Find-TargetProcess
    $entry = Get-ElementByIndex $proc $Index
    $el = $entry.el
    $via = ''
    $vp = $null
    if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
      $vp.SetValue($Text)
      $via = 'value-pattern'
    } else {
      $el.SetFocus()
      Start-Sleep -Milliseconds 150
      # Escape first, THEN turn newlines into {ENTER} (escaping would mangle it).
      $escaped = Escape-SendKeys $Text
      $escaped = $escaped -replace "`r`n", '{ENTER}' -replace "`n", '{ENTER}'
      [System.Windows.Forms.SendKeys]::SendWait('^a')
      [System.Windows.Forms.SendKeys]::SendWait('{DEL}')
      [System.Windows.Forms.SendKeys]::SendWait($escaped)
      $via = 'keyboard'
    }
    Start-Sleep -Milliseconds 250
    # Read the value back: acceptance is not proof the text landed.
    $readBack = Get-ElementValue $el
    Out-Json @{
      ok           = $true
      action       = 'setValue'
      via          = $via
      target       = $entry.info
      requested    = $Text
      readBack     = $readBack
      landed       = ($readBack -eq $Text -or $readBack.EndsWith($Text))
      pid          = $proc.Id
      process      = $proc.ProcessName
      windowTitle  = [string]$proc.MainWindowTitle
      focusedAfter = Get-FocusedInfo
    }
    exit 0
  }

  'pressKey' {
    if (-not $Key.Trim()) { Fail 'INVALID_ARGUMENT' 'no key given (e.g. Enter, ctrl+a, alt+F4)' }
    $proc = Find-TargetProcess
    $seq = ''
    try { $seq = Convert-Key $Key } catch { Fail 'INVALID_ARGUMENT' $_.Exception.Message }
    [Native.Mouse]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait($seq)
    Start-Sleep -Milliseconds 350
    Out-Json @{
      ok           = $true
      action       = 'pressKey'
      sent         = $seq
      pid          = $proc.Id
      process      = $proc.ProcessName
      windowTitle  = [string]$proc.MainWindowTitle
      focusedAfter = Get-FocusedInfo
    }
    exit 0
  }

  'focus' {
    $proc = Find-TargetProcess
    $entry = Get-ElementByIndex $proc $Index
    $entry.el.SetFocus()
    Start-Sleep -Milliseconds 200
    Out-Json @{
      ok           = $true
      action       = 'focus'
      target       = $entry.info
      pid          = $proc.Id
      process      = $proc.ProcessName
      windowTitle  = [string]$proc.MainWindowTitle
      focusedAfter = Get-FocusedInfo
    }
    exit 0
  }

  'scroll' {
    $proc = Find-TargetProcess
    $pages = 1
    [Native.Mouse]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 250
    $win = Get-WindowElement $proc
    $r = $win.Current.BoundingRectangle
    $x = [int]($r.X + $r.Width / 2); $y = [int]($r.Y + $r.Height / 2)
    [Native.Mouse]::SetCursorPos($x, $y) | Out-Null
    $dir = $Direction.ToLower()
    if ($dir -ne 'down' -and $dir -ne 'up') { Fail 'INVALID_ARGUMENT' "direction must be up or down (got '$Direction')" }
    $delta = if ($dir -eq 'down') { -360 } else { 360 }
    [Native.Mouse]::mouse_event(0x0800, 0, 0, [uint32]([Math]::Abs($delta)), [System.UIntPtr]::Zero)
    if ($delta -lt 0) { Start-Sleep -Milliseconds 120; [Native.Mouse]::mouse_event(0x0800, 0, 0, [uint32]([Math]::Abs($delta)), [System.UIntPtr]::Zero) }
    Start-Sleep -Milliseconds 350
    Out-Json @{ ok = $true; action = 'scroll'; direction = $dir; windowTitle = [string]$proc.MainWindowTitle }
    exit 0
  }

  'performAction' {
    if (-not $ActionName.Trim()) { Fail 'INVALID_ARGUMENT' 'no actionName given (invoke, toggle, select, expand, collapse, scrollintoview)' }
    $proc = Find-TargetProcess
    $entry = Get-ElementByIndex $proc $Index
    $el = $entry.el
    $name = $ActionName.Trim().ToLower()
    $map = @{
      invoke         = 'Invoke'
      toggle         = 'Toggle'
      select         = 'SelectionItem'
      expand         = 'ExpandCollapse'
      collapse       = 'ExpandCollapse'
      scrollintoview = 'ScrollItem'
    }
    if (-not $map.ContainsKey($name)) { Fail 'ACTION_UNAVAILABLE' "unknown pattern action '$ActionName'" }
    $ptype = $PATTERNS[$map[$name]]
    $p = $null
    if (-not $el.TryGetCurrentPattern($ptype, [ref]$p)) {
      Fail 'ACTION_UNAVAILABLE' "element does not advertise $($map[$name]); it advertises: $($entry.info.patterns -join ', ')"
    }
    switch ($name) {
      'invoke' { $p.Invoke() }
      'toggle' { $p.Toggle() }
      'select' { $p.Select() }
      'expand' { $p.Expand() }
      'collapse' { $p.Collapse() }
      'scrollintoview' { $p.ScrollIntoView() }
    }
    Start-Sleep -Milliseconds 350
    Out-Json @{
      ok           = $true
      action       = 'performAction'
      performed    = $name
      target       = $entry.info
      pid          = $proc.Id
      process      = $proc.ProcessName
      windowTitle  = [string]$proc.MainWindowTitle
      focusedAfter = Get-FocusedInfo
    }
    exit 0
  }

  default {
    Fail 'INVALID_ARGUMENT' "unknown action: $Action"
  }
}

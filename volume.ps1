$code = @"
using System.Runtime.InteropServices;
public class Audio {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
}
"@
Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue

$action = $args[0]
$amount = 10
if ($args.Length -gt 1) { $amount = [int]$args[1] }

function Send-Key($vk, $times) {
    for($i=0; $i -lt $times; $i++) {
        [Audio]::keybd_event($vk, 0, 0, 0)
        [Audio]::keybd_event($vk, 0, 2, 0)
    }
}

if ($action -eq 'set') {
    # Hack: To set an absolute volume using hardware keys, 
    # we first lower the volume to 0 (50 presses, each is 2%), then raise it to the desired level.
    Send-Key 174 50
    $presses = [math]::Round($amount / 2)
    Send-Key 175 $presses
}
elseif ($action -eq 'up') {
    $presses = [math]::Round($amount / 2)
    if ($presses -lt 1) { $presses = 1 }
    Send-Key 175 $presses
}
elseif ($action -eq 'down') {
    $presses = [math]::Round($amount / 2)
    if ($presses -lt 1) { $presses = 1 }
    Send-Key 174 $presses
}
elseif ($action -eq 'mute' -or $action -eq 'unmute') {
    Send-Key 173 1
}

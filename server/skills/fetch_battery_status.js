/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — FETCH BATTERY STATUS
   ========================================================================== */

import { execFile } from 'child_process';
import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';

export default {
  name: 'fetch_battery_status',
  description: 'Gets the battery percentage and charging state.',
  parameters: { type: 'object', properties: {}, required: [] },
  risk: RISK.SAFE,
  permissions: [PERMISSION.READ_SYSTEM],
  confirmation: CONFIRMATION.NONE,

  execute() {
    const battery = new Promise((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance -ClassName Win32_Battery | Select-Object EstimatedChargeRemaining, BatteryStatus | ConvertTo-Json -Compress'],
        { windowsHide: true, timeout: 12000 },
        (err, stdout) => resolve(err ? null : stdout)
      );
    });
    return battery.then((raw) => {
      if (!raw || !raw.trim()) return 'No battery detected — this machine appears to be a desktop running on mains power.';
      try {
        const data = JSON.parse(raw);
        const b = Array.isArray(data) ? data[0] : data;
        const charging = b.BatteryStatus === 2 || b.BatteryStatus === 6 || b.BatteryStatus === 7 || b.BatteryStatus === 8;
        return `Battery is at ${b.EstimatedChargeRemaining} percent and ${charging ? 'charging' : 'on battery power'}.`;
      } catch (e) {
        return 'Error: battery data could not be read.';
      }
    });
  }
};

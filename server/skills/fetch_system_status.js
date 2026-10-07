/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — FETCH SYSTEM STATUS (CPU / memory)
   ========================================================================== */

import os from 'os';
import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';

function systemStats() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const cpus = os.cpus();
  let idle = 0, total = 0;
  cpus.forEach(c => { for (const t in c.times) total += c.times[t]; idle += c.times.idle; });
  return {
    cpuUsagePercent: total > 0 ? Math.min(100, Math.max(5, Math.round(100 - (idle / total) * 100))) : 15,
    memUsagePercent: Math.round(((totalMem - freeMem) / totalMem) * 100)
  };
}

export default {
  name: 'fetch_system_status',
  description: 'Gets current CPU and memory usage.',
  parameters: { type: 'object', properties: {}, required: [] },
  risk: RISK.SAFE,
  permissions: [PERMISSION.READ_SYSTEM],
  confirmation: CONFIRMATION.NONE,

  execute() {
    const stats = systemStats();
    return `CPU load ${stats.cpuUsagePercent} percent, memory usage ${stats.memUsagePercent} percent.`;
  }
};

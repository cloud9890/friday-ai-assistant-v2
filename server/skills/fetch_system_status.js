/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — FETCH SYSTEM STATUS (CPU / memory)
   ========================================================================== */

import os from 'os';
import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';

function systemStats(osImpl = os) {
  const totalMem = osImpl.totalmem();
  const freeMem = osImpl.freemem();
  const cpus = osImpl.cpus() || [];
  let idle = 0, total = 0;
  for (const c of cpus) {
    for (const t in c.times) total += c.times[t];
    idle += c.times.idle;
  }
  // M1: no invented numbers. If the OS gives us nothing to measure, report
  // "unavailable" (null) rather than the old fabricated floor of 5% / sentinel 15.
  const cpuUsagePercent = total > 0
    ? Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100)))
    : null;
  const memUsagePercent = totalMem > 0
    ? Math.max(0, Math.min(100, Math.round(((totalMem - freeMem) / totalMem) * 100)))
    : null;
  return { cpuUsagePercent, memUsagePercent };
}

export { systemStats };

export default {
  name: 'fetch_system_status',
  description: 'Gets current CPU and memory usage.',
  parameters: { type: 'object', properties: {}, required: [] },
  risk: RISK.SAFE,
  permissions: [PERMISSION.READ_SYSTEM],
  confirmation: CONFIRMATION.NONE,

  execute() {
    const stats = systemStats();
    const cpu = stats.cpuUsagePercent === null
      ? 'CPU load is unavailable on this system'
      : `CPU load ${stats.cpuUsagePercent} percent`;
    const mem = stats.memUsagePercent === null
      ? 'memory usage is unavailable'
      : `memory usage ${stats.memUsagePercent} percent`;
    return `${cpu}, ${mem}.`;
  }
};

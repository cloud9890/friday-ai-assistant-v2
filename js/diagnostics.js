/* ==========================================================================
   F.R.I.D.A.Y. // DIAGNOSTICS — real system check runner
   Replaces the fictional "tactical protocols". Every check reads a real
   browser/device signal and the overlay reports the actual result.
   ========================================================================== */

import { checkHealth } from './ai-client.js';
import { soundFX } from '../sound-fx.js';

export class DiagnosticsManager {
  constructor(app) {
    this.app = app;
  }

  async run() {
    soundFX.playScan();

    // Running phase: show the report panel immediately with a scan state.
    this.app.protocolOverlay.dataset.state = 'running';
    this.app.protocolOverlayTitle.textContent = 'SYSTEM DIAGNOSTIC';
    this.app.protocolOverlayIcon.textContent = '';
    this.app.protocolOverlay.classList.add('active');

    const health = await checkHealth();
    const rows = [];

    // Every check reads a real browser/device signal; each row carries a
    // state so the report can colour-code it. Provider names stay out of the
    // report — the HUD-level distinction is cloud vs local backup.
    if (health.ok && health.configured) {
      const kind = health.provider === 'groq' ? 'CLOUD' : 'LOCAL';
      const backup = health.fallbackConfigured ? ' · BACKUP READY' : '';
      rows.push({ label: 'NEURAL LINK', value: `ONLINE · ${kind}${backup}`, state: 'ok' });
    } else if (health.ok) {
      rows.push({ label: 'NEURAL LINK', value: 'NO PROVIDER', state: 'warn' });
    } else {
      rows.push({ label: 'NEURAL LINK', value: 'UNREACHABLE', state: 'bad' });
    }

    rows.push({
      label: 'LINK LATENCY',
      value: `${health.latencyMs} ms`,
      state: health.latencyMs < 100 ? 'ok' : 'warn'
    });

    const battery = this.app.telemetryMonitor ? this.app.telemetryMonitor.battery : null;
    if (battery) {
      const pct = Math.round(battery.level * 100);
      rows.push({ label: 'BATTERY', value: `${pct}% · ${battery.charging ? 'CHARGING' : 'ON BATTERY'}`, state: 'ok' });
    } else {
      rows.push({ label: 'BATTERY', value: 'N/A', state: 'dim' });
    }

    rows.push({
      label: 'LOGICAL CORES',
      value: Number.isFinite(navigator.hardwareConcurrency) ? String(navigator.hardwareConcurrency) : 'N/A',
      state: Number.isFinite(navigator.hardwareConcurrency) ? 'info' : 'dim'
    });

    rows.push({
      label: 'DEVICE MEMORY',
      value: Number.isFinite(navigator.deviceMemory) ? `${navigator.deviceMemory} GB` : 'N/A',
      state: Number.isFinite(navigator.deviceMemory) ? 'info' : 'dim'
    });

    const mem = typeof performance !== 'undefined' ? performance.memory : null;
    if (mem && mem.jsHeapSizeLimit) {
      const pct = Math.round((mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100);
      rows.push({ label: 'JS HEAP', value: `${pct}%`, state: pct > 90 ? 'bad' : pct > 70 ? 'warn' : 'ok' });
    } else {
      rows.push({ label: 'JS HEAP', value: 'N/A', state: 'dim' });
    }

    const sttOk = this.app.voiceEngine && this.app.voiceEngine.sttSupported;
    rows.push({ label: 'SPEECH RECOGNITION', value: sttOk ? 'SUPPORTED' : 'UNAVAILABLE', state: sttOk ? 'ok' : 'dim' });

    // Worst row decides the report's overall state ring.
    const rank = { bad: 3, warn: 2, ok: 1, info: 0, dim: 0 };
    const worst = rows.reduce((acc, r) => (rank[r.state] > rank[acc] ? r.state : acc), 'ok');
    this.app.protocolOverlay.dataset.state = worst;

    this.app.protocolOverlayTitle.textContent = 'DIAGNOSTIC COMPLETE';
    this.app.protocolOverlayIcon.textContent = worst === 'bad' ? '✕' : '✓';

    // Structured report rows (built with textContent — no injection surface).
    const list = this.app.protocolOverlayDesc;
    list.innerHTML = '';
    rows.forEach((row, i) => {
      const li = document.createElement('li');
      li.className = `report-row ${row.state}`;
      li.style.animationDelay = `${i * 60}ms`;
      const label = document.createElement('span');
      label.className = 'r-label';
      label.textContent = row.label;
      const value = document.createElement('span');
      value.className = 'r-value';
      value.textContent = row.value;
      li.appendChild(label);
      li.appendChild(value);
      list.appendChild(li);
    });

    this.app.protocolOverlay.classList.add('active');

    // One clean spoken/chat reply — the detail lives in the report overlay.
    const issues = rows.filter(r => r.state === 'warn' || r.state === 'bad').length;
    const summary = issues === 0
      ? 'Diagnostic complete, Boss. All systems are running clean.'
      : `Diagnostic complete, Boss. ${issues} system${issues > 1 ? 's need' : ' needs'} your attention — full report on screen.`;
    this.app.uiManager.appendChatMessage('friday', summary);
    if (typeof this.app.logEvent === 'function') this.app.logEvent('Full diagnostic run complete');

    return summary;
  }
}
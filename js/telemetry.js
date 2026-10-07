/* ==========================================================================
   F.R.I.D.A.Y. // TELEMETRY MONITOR — real browser metrics
   Reads genuine, permission-free browser/device signals. Nothing is invented:
   any metric the browser does not expose is rendered as "N/A".
   ========================================================================== */

import { checkHealth } from './ai-client.js';

export class TelemetryMonitor {
  constructor(app) {
    this.app = app;
    this.battery = null;
    this._initBattery();
  }

  async _initBattery() {
    if (typeof navigator.getBattery !== 'function') return;
    try {
      this.battery = await navigator.getBattery();
      this._renderBattery();
      this.battery.addEventListener('levelchange', () => this._renderBattery());
      this.battery.addEventListener('chargingchange', () => this._renderBattery());
    } catch (e) {
      console.warn('Battery API unavailable:', e && e.message);
    }
  }

  _renderBattery() {
    if (!this.battery) return;
    const pct = Math.round(this.battery.level * 100);
    if (this.app.batteryVal) this.app.batteryVal.textContent = `${pct}%`;
    if (this.app.batteryBar) this.app.batteryBar.style.width = `${pct}%`;
    if (this.app.chargeStateVal) {
      this.app.chargeStateVal.textContent = this.battery.charging ? 'CHARGING' : 'ON BATTERY';
    }
  }

  async start() {
    this.renderStatic();
    await this.updateOnce();
    setInterval(() => this.updateOnce(), 3000);
  }

  /* One-time device facts (cores, memory, network class). */
  renderStatic() {
    if (this.app.coresVal) {
      this.app.coresVal.textContent = Number.isFinite(navigator.hardwareConcurrency)
        ? String(navigator.hardwareConcurrency) : 'N/A';
    }
    if (this.app.deviceMemVal) {
      this.app.deviceMemVal.textContent = Number.isFinite(navigator.deviceMemory)
        ? `${navigator.deviceMemory} GB` : 'N/A';
    }

    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (this.app.scanNetType) {
      this.app.scanNetType.textContent = conn && conn.effectiveType ? conn.effectiveType.toUpperCase() : 'UNKNOWN';
    }
    if (this.app.scanDownlink) {
      this.app.scanDownlink.textContent = conn && Number.isFinite(conn.downlink) ? `${conn.downlink} Mbps` : 'N/A';
    }
  }

  async updateOnce() {
    // JS heap usage (Chromium exposes performance.memory).
    const mem = typeof performance !== 'undefined' ? performance.memory : null;
    if (mem && mem.jsHeapSizeLimit) {
      const pct = Math.round((mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100);
      if (this.app.heapVal) this.app.heapVal.textContent = `${pct}%`;
      if (this.app.heapBar) this.app.heapBar.style.width = `${pct}%`;
    } else if (this.app.heapVal) {
      this.app.heapVal.textContent = 'N/A';
    }

    // Real round-trip latency to the local AI proxy.
    const health = await checkHealth();
    if (this.app.pingVal) this.app.pingVal.textContent = `${health.latencyMs} ms`;
    if (this.app.pingBar) this.app.pingBar.style.width = `${Math.min(100, health.latencyMs)}%`;
    if (this.app.linkVal) {
      this.app.linkVal.textContent = health.ok
        ? (health.configured ? 'ONLINE' : 'NO PROVIDER')
        : 'UNREACHABLE';
    }

    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (this.app.scanRtt) {
      this.app.scanRtt.textContent = conn && Number.isFinite(conn.rtt) ? `${conn.rtt} ms` : 'N/A';
    }

    if (typeof this.app.handleLinkHealth === 'function') this.app.handleLinkHealth(health);
  }
}
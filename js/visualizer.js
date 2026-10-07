/* ==========================================================================
   F.R.I.D.A.Y. // HOLOGRAM VISUALIZER — ARC REACTOR + SPECTRUM CANVAS
   Pure Canvas 2D rendering. Original draw routines kept verbatim; the old
   voice-engine dependency is replaced by a plain "voice state" object that
   exposes isSpeaking / isListening / getFrequencyData().
   ========================================================================== */

export class HologramVisualizer {
  constructor(voiceState) {
    this.voiceState = voiceState;

    this.arcCanvas = document.getElementById('arcCanvas');
    this.arcCtx = this.arcCanvas ? this.arcCanvas.getContext('2d') : null;
    this.spectrumCanvas = document.getElementById('spectrumCanvas');
    this.spectrumCtx = this.spectrumCanvas ? this.spectrumCanvas.getContext('2d') : null;
    this.animFrameId = null;
    this._peaks = null;          // falling peak caps, one per bar
    this._spectrumW = 0;         // backing-store size (resized to HiDPI)
    this._spectrumH = 0;
  }

  /* ------------------------------------------------------------------------
     CANVAS VISUALIZER (ARC REACTOR & SPECTRUM)
     ------------------------------------------------------------------------ */
  start() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    const render = () => {
      this.drawArcReactor();
      this.drawSpectrum();
      this.animFrameId = requestAnimationFrame(render);
    };
    render();
  }

  drawArcReactor() {
    if (!this.arcCtx || !this.arcCanvas) return;
    const ctx = this.arcCtx;
    const w = this.arcCanvas.width;
    const h = this.arcCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const time = Date.now() * 0.0015;

    ctx.clearRect(0, 0, w, h);

    const isSpeaking = this.voiceState.isSpeaking;
    const isListening = this.voiceState.isListening;

    // Get voice frequency data for core pulse
    const freqData = this.voiceState.getFrequencyData();
    let avgFreq = 0;
    for (let i = 0; i < freqData.length; i++) avgFreq += freqData[i];
    avgFreq = (avgFreq / freqData.length) / 255;

    let primaryColor = '#00f0ff';
    let glowRgb = '0, 240, 255';
    if (isSpeaking) {
      primaryColor = '#ffaa00';
      glowRgb = '255, 170, 0';
    } else if (isListening) {
      primaryColor = '#00ffaa';
      glowRgb = '0, 255, 170';
    }

    // 1. Central Core Glow Gradient
    const corePulse = 48 + Math.sin(time * 3) * 3 + (avgFreq * 25);
    const grad = ctx.createRadialGradient(cx, cy, 5, cx, cy, corePulse + 30);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.25, `rgba(${glowRgb}, 0.85)`);
    grad.addColorStop(0.65, `rgba(${glowRgb}, 0.25)`);
    grad.addColorStop(1, 'transparent');

    ctx.beginPath();
    ctx.arc(cx, cy, corePulse + 30, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // 2. Outer Rotating HUD Ring (Clockwise)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(time * 0.5);
    ctx.strokeStyle = `rgba(${glowRgb}, 0.4)`;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, 102, (i * Math.PI / 2), (i * Math.PI / 2) + Math.PI / 3);
      ctx.stroke();
    }
    ctx.restore();

    // 3. Counter-Rotating Dashed Ring
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-time * 0.7);
    ctx.strokeStyle = `rgba(${glowRgb}, 0.6)`;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 8]);
    ctx.beginPath();
    ctx.arc(0, 0, 90, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // 4. 10 Rotating Coils / Repulsor Nodes
    const segments = 10;
    const coilRadius = 72;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(time * 0.3);

    for (let i = 0; i < segments; i++) {
      const angle = (i * (Math.PI * 2 / segments));
      const nx = Math.cos(angle) * coilRadius;
      const ny = Math.sin(angle) * coilRadius;

      // Draw coil node
      ctx.beginPath();
      ctx.arc(nx, ny, isSpeaking ? 5.5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = primaryColor;
      ctx.shadowColor = primaryColor;
      ctx.shadowBlur = 12;
      ctx.fill();

      // Connector line to center
      ctx.beginPath();
      ctx.moveTo(nx * 0.65, ny * 0.65);
      ctx.lineTo(nx * 0.9, ny * 0.9);
      ctx.strokeStyle = `rgba(${glowRgb}, 0.5)`;
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 0;
      ctx.stroke();
    }
    ctx.restore();

    // 5. Inner Accent Ring
    ctx.beginPath();
    ctx.arc(cx, cy, 48, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${glowRgb}, 0.8)`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /* Keeps the canvas backing store matched to its rendered size and the
     device pixel ratio, so the instrument stays crisp on any display. */
  _resizeSpectrum() {
    const canvas = this.spectrumCanvas;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w;
      canvas.height = h;
      this._peaks = null; // bar count may change with the width
    }
    this._spectrumW = canvas.width;
    this._spectrumH = canvas.height;
  }

  drawSpectrum() {
    if (!this.spectrumCtx || !this.spectrumCanvas) return;
    this._resizeSpectrum();

    const ctx = this.spectrumCtx;
    const w = this._spectrumW;
    const h = this._spectrumH;
    if (w === 0 || h === 0) return;
    ctx.clearRect(0, 0, w, h);

    const isSpeaking = this.voiceState.isSpeaking;
    const isListening = this.voiceState.isListening;
    const freqData = this.voiceState.getFrequencyData();
    const len = freqData.length;

    // Palette follows the real voice state.
    const rgb = isSpeaking ? '255, 170, 0' : isListening ? '0, 255, 170' : '0, 240, 255';

    const midY = h / 2;
    const cx = w / 2;
    const maxBar = h * 0.4;
    const dpr = window.devicePixelRatio || 1;

    // The graph radiates from the middle: low frequencies sit at the centre
    // and the spectrum mirrors outward to both edges.
    const halfLen = Math.ceil(len / 2);
    const slot = (w / 2) / halfLen;
    const barW = Math.max(2 * dpr, slot * 0.45);

    // Slow-falling peak caps, one per frequency bin (shared by both mirrors).
    if (!this._peaks || this._peaks.length !== halfLen) {
      this._peaks = new Array(halfLen).fill(0);
    }

    // 1. Mirrored equalizer bars: up/down around the centre line and
    //    left/right around the centre point.
    for (let i = 0; i < halfLen; i++) {
      const level = freqData[i] / 255;
      const barH = Math.max(2, level * maxBar);
      const xOff = i * slot + (slot - barW) / 2;
      const peak = this._peaks[i];
      this._peaks[i] = Math.max(barH, peak - maxBar * 0.022);

      for (const x of [cx + xOff, cx - xOff - barW]) {
        const grad = ctx.createLinearGradient(0, midY - barH, 0, midY + barH);
        grad.addColorStop(0, `rgba(${rgb}, 0.95)`);
        grad.addColorStop(0.5, `rgba(${rgb}, 0.5)`);
        grad.addColorStop(1, `rgba(${rgb}, 0.95)`);
        ctx.fillStyle = grad;
        ctx.fillRect(x, midY - barH, barW, barH * 2);

        // Peak caps ride just beyond the current bar height.
        ctx.fillStyle = `rgba(${rgb}, 0.9)`;
        ctx.fillRect(x, midY - this._peaks[i] - 2 * dpr, barW, 2 * dpr);
        ctx.fillRect(x, midY + this._peaks[i], barW, 2 * dpr);
      }
    }

    // 2. Glowing waveform, symmetric around the centre point.
    ctx.beginPath();
    const halfCount = Math.floor(len / 2);
    const step = (w / 2) / halfCount;
    const ampAt = (i) => ((freqData[i] - 128) / 128) * (h * 0.34);
    for (let i = 0; i <= halfCount; i++) {
      const x = cx + i * step;
      const y = midY - ampAt(i);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    for (let i = halfCount; i >= 0; i--) {
      ctx.lineTo(cx - i * step, midY - ampAt(i));
    }
    ctx.strokeStyle = `rgba(${rgb}, 0.95)`;
    ctx.lineWidth = 1.5 * dpr;
    ctx.shadowColor = `rgba(${rgb}, 0.9)`;
    ctx.shadowBlur = 7;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 3. Centre baseline + tick ruler along the middle.
    ctx.fillStyle = `rgba(${rgb}, 0.25)`;
    ctx.fillRect(0, midY, w, 1);
    const tickH = 3 * dpr;
    for (let i = 0; i <= 20; i++) {
      const x = Math.round((w / 20) * i);
      ctx.fillRect(x, midY - tickH, 1, tickH * 2);
    }
  }
}
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
    const dpr = window.devicePixelRatio || 1;
    const t = Date.now() / 1000;

    /* Real voice energy: average of the voice-relevant low/mid bins, eased
       with a fast attack and slow release so the wave swells when Boss talks
       and decays gracefully afterwards. */
    let energy = 0;
    for (let i = 1; i < len / 2; i++) energy += freqData[i];
    energy = energy / (len / 2) / 255;
    if (this._level === undefined) this._level = 0;
    this._level = Math.max(energy, this._level * 0.94);
    const level = this._level;

    // --- Layer 1: slim mirrored frequency bars, radiating from the centre ---
    const halfLen = Math.ceil(len / 2);
    const slot = (w / 2) / halfLen;
    const barW = Math.max(2 * dpr, slot * 0.4);
    const maxBar = h * 0.32;

    ctx.fillStyle = `rgba(${rgb}, 0.18)`;
    for (let i = 0; i < halfLen; i++) {
      const barH = Math.max(2 * dpr, (freqData[i] / 255) * maxBar);
      const xOff = i * slot + (slot - barW) / 2;
      for (const x of [cx + xOff, cx - xOff - barW]) {
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(x, midY - barH, barW, barH * 2, barW / 2);
          ctx.fill();
        } else {
          ctx.fillRect(x, midY - barH, barW, barH * 2);
        }
      }
    }

    // --- Layer 2: the voiceprint — three flowing wave strokes ---------------
    // Organic Siri-style motion: superimposed sines whose amplitude is driven
    // by real voice energy, with an envelope that peaks at the centre and
    // dissolves toward the edges. Breathes gently even in silence.
    const amp = h * (0.10 + 0.34 * level);
    const env = (x) => Math.pow(Math.sin(Math.PI * x / w), 1.2);
    const waveY = (x, f, speed, phase) =>
      midY + Math.sin(x * f + t * speed + phase) * amp * env(x)
           + Math.sin(x * f * 2.3 + t * speed * 1.7 + phase * 2) * amp * 0.35 * env(x);

    const layers = [
      { f: 0.018, speed: 1.5,  phase: 0.0, width: 7 * dpr, alpha: 0.10 },
      { f: 0.012, speed: -1.1, phase: 2.1, width: 4 * dpr, alpha: 0.22 },
      { f: 0.006, speed: 0.9,  phase: 4.2, width: 1.6 * dpr, alpha: 0.95 }
    ];

    for (const L of layers) {
      ctx.beginPath();
      const steps = 90;
      for (let i = 0; i <= steps; i++) {
        const x = (w / steps) * i;
        const y = waveY(x, L.f, L.speed, L.phase);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(${rgb}, ${L.alpha})`;
      ctx.lineWidth = L.width;
      if (L.alpha > 0.5) {
        ctx.shadowColor = `rgba(${rgb}, 0.9)`;
        ctx.shadowBlur = 8;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }
}
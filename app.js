/* ==========================================================================
   F.R.I.D.A.Y. // CORE APPLICATION CONTROLLER
   --------------------------------------------------------------------------
   Real wiring only:
     - AI replies via the same-origin /api/chat proxy (Groq / Ollama).
     - Voice in/out via the real VoiceEngine (Web Speech STT + ElevenLabs TTS).
     - Telemetry, diagnostics, power and network read genuine browser signals.
   Nothing is simulated: when a source is unavailable the UI says so.
   ========================================================================== */

import { soundFX } from './sound-fx.js';
import { UIManager } from './ui-manager.js';
import { VoiceEngine } from './js/voice.js';
import { runAgent, checkHealth } from './js/ai-client.js';
import { HologramVisualizer } from './js/visualizer.js';
import { TelemetryMonitor } from './js/telemetry.js';
import { DirectiveManager } from './js/directives.js';
import { DiagnosticsManager } from './js/diagnostics.js';
import { ScreenShareManager } from './js/screen.js';

const SYSTEM_PROMPT = `You are F.R.I.D.A.Y., Tony Stark's futuristic, polite, tactical AI assistant. Address the user as "Boss". Keep spoken replies natural, concise and punchy - one or two short sentences. Never use emojis, markdown or bullet points, because your replies are spoken aloud. Never use filler phrases like "Let me know if you need anything else". Be direct, like a tactical AI. If you genuinely do not know something, say so plainly.`;

const MAX_CONTEXT_MESSAGES = 10;
const STOP_WORDS = ['stop', 'quiet', 'cancel', 'shut up', 'pause'];

function stripWakeWord(text) {
  return String(text || '').toLowerCase().replace(/^(friday|hey friday|ok friday|hi friday)[,\s]*/i, '').trim();
}

class FridayApp {
  constructor() {
    this.voiceEngine = new VoiceEngine();
    this.uiManager = new UIManager();
    this.screenShare = new ScreenShareManager();

    this.directives = [];
    this.conversation = [];              // real short-term memory (this session only)
    this.currentTaskController = null;
    this.lastLinkHealth = null;
    this.linkDegraded = false;
    this.baseLinkState = null;
    this.tickerEvents = [];

    this.initDOM();

    this.visualizer = new HologramVisualizer(this.voiceEngine);
    this.telemetryMonitor = new TelemetryMonitor(this);
    this.directiveManager = new DirectiveManager(this);
    this.diagnosticsManager = new DiagnosticsManager(this);

    this.visualizer.start();
    this.initEventListeners();
    this.initVoiceCallbacks();
    this.startClockTicker();
    this.telemetryMonitor.start();
    this.directiveManager.loadPersistentData();
    this.requestLocation();
    this.bootstrap();

    // Always-on wake word: the mic goes hot on page load. Chromium's
    // AudioContext needs one user gesture before it will analyse audio.
    this.voiceEngine.startAmbientListening();
    document.addEventListener('click', () => this.voiceEngine.resumeAudio(), { once: true });

    soundFX.playPowerUp();
  }

  /* ------------------------------------------------------------------------
     DOM INITIALIZATION
     ------------------------------------------------------------------------ */
  initDOM() {
    this.statusBadge = document.getElementById('statusBadge');
    this.statusText = document.getElementById('statusText');
    this.clockDisplay = document.getElementById('clockDisplay');
    this.footerStatus = document.getElementById('footerStatus');
    this.tickerText = document.getElementById('tickerText');

    this.btnToggleSound = document.getElementById('btnToggleSound');
    this.btnToggleVoice = document.getElementById('btnToggleVoice');
    this.btnToggleScreen = document.getElementById('btnToggleScreen');

    this.voiceBannerText = document.getElementById('voiceBannerText');
    this.voicePulsar = document.getElementById('voicePulsar');

    this.chatStream = document.getElementById('chatStream');
    this.cmdInput = document.getElementById('cmdInput');
    this.btnSend = document.getElementById('btnSend');

    // Power & compute
    this.batteryVal = document.getElementById('batteryVal');
    this.batteryBar = document.getElementById('batteryBar');
    this.chargeStateVal = document.getElementById('chargeStateVal');
    this.deviceMemVal = document.getElementById('deviceMemVal');
    this.coresVal = document.getElementById('coresVal');

    // Network & environment
    this.scanLoc = document.getElementById('scanLoc');
    this.scanNetType = document.getElementById('scanNetType');
    this.scanDownlink = document.getElementById('scanDownlink');
    this.scanRtt = document.getElementById('scanRtt');

    // System diagnostics
    this.heapVal = document.getElementById('heapVal');
    this.heapBar = document.getElementById('heapBar');
    this.pingVal = document.getElementById('pingVal');
    this.pingBar = document.getElementById('pingBar');
    this.linkVal = document.getElementById('linkVal');

    // Directives
    this.directiveInput = document.getElementById('directiveInput');
    this.btnAddDirective = document.getElementById('btnAddDirective');
    this.directiveList = document.getElementById('directiveList');
    this.directiveCount = document.getElementById('directiveCount');

    // Checks & overlay
    this.btnRunDiagnostics = document.getElementById('btnRunDiagnostics');
    this.protocolOverlay = document.getElementById('protocolOverlay');
    this.protocolOverlayIcon = document.getElementById('protocolOverlayIcon');
    this.protocolOverlayTitle = document.getElementById('protocolOverlayTitle');
    this.protocolOverlayDesc = document.getElementById('protocolOverlayDesc');
    this.btnDismissProtocol = document.getElementById('btnDismissProtocol');
  }

  /* ------------------------------------------------------------------------
     EVENT LISTENERS & BINDINGS
     ------------------------------------------------------------------------ */
  initEventListeners() {
    this.btnSend.addEventListener('click', () => this.handleUserCommand());
    this.cmdInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleUserCommand();
    });

    // The mic is always on (wake word "Friday"); there is no mic toggle.
    // The engine emits the true status (ambient / awaiting / denied).
    document.querySelectorAll('.quick-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        this.cmdInput.value = chip.getAttribute('data-cmd') || '';
        this.handleUserCommand();
      });
    });

    this.btnToggleSound.addEventListener('click', () => {
      soundFX.enabled = !soundFX.enabled;
      this.btnToggleSound.classList.toggle('active', soundFX.enabled);
      if (soundFX.enabled) soundFX.playClick();
    });

    this.btnToggleVoice.addEventListener('click', () => {
      this.voiceEngine.voiceOutputEnabled = !this.voiceEngine.voiceOutputEnabled;
      this.btnToggleVoice.classList.toggle('active', this.voiceEngine.voiceOutputEnabled);
      soundFX.playClick();
    });

    // Screen sharing: lets the agent see and analyse the display. The
    // browser asks for permission on first enable; the browser can also end
    // sharing from its own UI, so the class tracks the real state.
    this.btnToggleScreen.addEventListener('click', async () => {
      soundFX.playClick();
      try {
        const enabled = await this.screenShare.toggle();
        this.btnToggleScreen.classList.toggle('active', enabled);
        this.logEvent(enabled ? 'Screen sharing ON' : 'Screen sharing OFF');
      } catch (err) {
        this.logEvent('Screen sharing refused');
        this.uiManager.appendChatMessage('friday', `I could not start screen sharing, Boss: ${err.message}`);
      }
    });

    this.btnAddDirective.addEventListener('click', () => this.directiveManager.addDirectiveFromInput());
    this.directiveInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.directiveManager.addDirectiveFromInput();
    });

    this.btnRunDiagnostics.addEventListener('click', () => this.diagnosticsManager.run());
    this.btnDismissProtocol.addEventListener('click', () => {
      soundFX.playClick();
      this.protocolOverlay.classList.remove('active');
    });

    // Escape dismisses the report, like every proper console.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.protocolOverlay.classList.contains('active')) {
        this.protocolOverlay.classList.remove('active');
      }
    });
  }

  /* ------------------------------------------------------------------------
     VOICE CALLBACKS (real status + real transcripts)
     ------------------------------------------------------------------------ */
  initVoiceCallbacks() {
    this.voiceEngine.onStatusChangeCallback = (status) => {
      this.uiManager.updateVoiceUIStatus(status);
    };
    this.voiceEngine.onTranscriptCallback = (transcript) => {
      this.cmdInput.value = transcript;
      this.handleUserCommand(transcript);
    };
  }

  /* ------------------------------------------------------------------------
     BOOTSTRAP & REAL LINK STATUS
     ------------------------------------------------------------------------ */
  async bootstrap() {
    this.logEvent('Interface initialised');
    const health = await checkHealth();
    this.handleLinkHealth(health);

    if (health.ok && health.configured) {
      // Provider specifics stay in the ticker; the chat stays in character.
      this.uiManager.appendChatMessage('friday', 'All systems online and standing by, Boss.');
      this.logEvent(`Neural link online (${health.provider}, fallback: ${health.fallbackConfigured ? health.fallback : 'none'})`);
    } else if (health.ok && !health.configured) {
      const fallbackNote = health.fallbackConfigured
        ? 'Running on my local backup model for now, Boss.'
        : "I'm running without my AI core, Boss. Set GROQ_API_KEY in .env or start Ollama to bring me fully online.";
      this.uiManager.appendChatMessage('friday', fallbackNote);
      this.logEvent('Cloud link not configured');
    } else {
      this.uiManager.appendChatMessage('friday', "I can't reach my core systems right now, Boss. Standing by.");
      this.logEvent('Neural link unreachable');
    }
  }

  handleLinkHealth(health) {
    this.lastLinkHealth = health;
    if (this.footerStatus) this.footerStatus.textContent = `STATUS: ${health.ok ? '200 OK' : 'LINK DOWN'}`;

    // Badge reflects the actual serving provider:
    //   groq (cloud)          -> CLOUD LINK
    //   ollama (local)        -> LOCAL MODEL
    //   neither               -> OFFLINE
    let label = 'F.R.I.D.A.Y. OFFLINE';
    let cls = 'status-offline';
    if (health.ok && health.configured) {
      const isCloud = health.provider === 'groq';
      label = isCloud ? 'F.R.I.D.A.Y. CLOUD LINK' : 'F.R.I.D.A.Y. LOCAL MODEL';
      cls = isCloud ? 'status-online' : 'status-local';
    } else if (health.ok && !health.configured && health.fallbackConfigured) { label = 'F.R.I.D.A.Y. LOCAL MODEL'; cls = 'status-local'; }

    this.baseLinkState = { label, cls };
    if (!this.linkDegraded) this.applyLinkState(label, cls);
  }

  applyLinkState(label, cls) {
    if (!this.statusBadge || !this.statusText) return;
    this.statusText.textContent = label;
    this.statusBadge.className = `hud-badge ${cls}`;
  }

  /* Honest status: a real provider failure downgrades the badge until the
     next successful reply, rather than falsely reporting ONLINE. */
  markDegraded() {
    this.linkDegraded = true;
    this.applyLinkState('F.R.I.D.A.Y. DEGRADED', 'status-local');
  }

  markHealthy() {
    if (!this.linkDegraded) return;
    this.linkDegraded = false;
    if (this.baseLinkState) this.applyLinkState(this.baseLinkState.label, this.baseLinkState.cls);
  }

  /* ------------------------------------------------------------------------
     LOCATION (real geolocation, permission-gated)
     ------------------------------------------------------------------------ */
  requestLocation() {
    if (!this.scanLoc) return;
    if (!navigator.geolocation) { this.scanLoc.textContent = 'UNAVAILABLE'; return; }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        this.scanLoc.textContent = `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
      },
      () => { this.scanLoc.textContent = 'WITHHELD'; },
      { timeout: 10000, maximumAge: 600000 }
    );
  }

  /* ------------------------------------------------------------------------
     LIVE TICKER (real events only)
     ------------------------------------------------------------------------ */
  logEvent(message) {
    this.tickerEvents.push(message);
    if (this.tickerEvents.length > 6) this.tickerEvents.shift();
    if (this.tickerText) this.tickerText.textContent = this.tickerEvents.join('  //  ');
  }

  /* ------------------------------------------------------------------------
     USER COMMAND PROCESSOR (real AI, real cancellation)
     ------------------------------------------------------------------------ */
  async handleUserCommand(rawText = null) {
    const text = (rawText || this.cmdInput.value).trim();
    if (!text) return;

    this.cmdInput.value = '';
    this.uiManager.appendChatMessage('user', text);
    soundFX.playClick();
    this.logEvent(`Command: ${text.slice(0, 60)}`);

    const clean = stripWakeWord(text);

    // Cancellation reaches the running request, not just the voice output.
    if (STOP_WORDS.includes(clean)) {
      if (this.currentTaskController) { this.currentTaskController.abort(); this.currentTaskController = null; }
      this.voiceEngine.stopSpeaking();
      this.uiManager.appendChatMessage('friday', 'Standing by, Boss.');
      this.uiManager.updateVoiceUIStatus('standby');
      return;
    }

    // Local intent: the diagnostic runner performs a real action locally.
    if (/\b(diagnostic|full scan|scan all|system check)\b/.test(clean)) {
      this.diagnosticsManager.run();
      return;
    }

    const thinkingId = this.uiManager.showThinkingIndicator();
    this.uiManager.updateVoiceUIStatus('thinking');

    if (this.currentTaskController) this.currentTaskController.abort();
    this.currentTaskController = new AbortController();
    const signal = this.currentTaskController.signal;

    try {
      const screenFrame = this.screenShare.enabled ? this.screenShare.captureFrame() : null;
      const result = await runAgent(
        [...this.conversation, { role: 'user', content: clean }],
        {
          signal,
          screenFrame,
          onEvent: (evt) => this.handleAgentEvent(evt, thinkingId)
        }
      );
      if (signal.aborted) return;
      this.processAgentResult(result, thinkingId, clean);
    } catch (err) {
      if (signal.aborted) {
        // Replaced by a newer command: drop the stale bubble silently.
        // (Explicit stop words already say "Standing by, Boss.")
        document.getElementById(thinkingId)?.remove();
        this._streamBuffer = '';
        return;
      }
      console.warn('Neural link error:', err && err.message);
      this.markDegraded();
      this.logEvent('Neural link error - local fallback');
      const fallback = this.localReply(clean);
      this.uiManager.resolveThinkingIndicator(thinkingId, fallback);
      this.voiceEngine.speak(fallback);
    } finally {
      if (this.currentTaskController && this.currentTaskController.signal === signal) {
        this.currentTaskController = null;
      }
    }
  }

  /* ------------------------------------------------------------------------
     AGENT RESULTS (actions, confirmations, replies)
     ------------------------------------------------------------------------ */
  /** Live streaming events: text deltas land in the thinking bubble, tool
      runs surface immediately so the HUD never looks frozen. */
  handleAgentEvent(evt, thinkingId) {
    if (evt.type === 'delta' || evt.type === 'reset') {
      if (evt.type === 'reset') this._streamBuffer = '';
      else this._streamBuffer = (this._streamBuffer || '') + evt.text;
      const bubble = document.getElementById(thinkingId);
      const content = bubble && bubble.querySelector('.msg-content');
      if (content) content.textContent = this._streamBuffer || '';
      return;
    }
    if (evt.type === 'tool') {
      this.uiManager.appendActionNote(`RUNNING — ${evt.name}…`);
      this.logEvent(`${evt.name} running`);
    }
  }

  processAgentResult(result, thinkingId, userText) {
    // A destructive action needs explicit user approval before it runs.
    if (result.pending) {
      const message = `Awaiting your approval, Boss. ${result.pending.description}`;
      this.uiManager.resolveThinkingIndicator(thinkingId, message);
      this.uiManager.appendConfirmation(
        result.pending.description,
        () => this.resolveConfirmation(result.pending.token, true),
        () => this.resolveConfirmation(result.pending.token, false)
      );
      this.logEvent(`Confirmation required: ${result.pending.tool}`);
      this.voiceEngine.speak(message);
      this.uiManager.updateVoiceUIStatus('standby');
      return;
    }

    this.displayActions(result.actions);

    const reply = (result.reply || '').trim() || 'Task executed, Boss.';
    if (userText) {
      this.conversation.push({ role: 'user', content: userText });
      this.conversation.push({ role: 'assistant', content: reply });
      this.conversation = this.conversation.slice(-MAX_CONTEXT_MESSAGES);
    }

    this.markHealthy();
    this.uiManager.resolveThinkingIndicator(thinkingId, reply);
    this.uiManager.updateVoiceUIStatus('standby');
    this.voiceEngine.speak(reply);
  }

  /* Friendly HUD labels for tool names — the raw skill name is plumbing. */
  static ACTION_LABELS = {
    open_desktop_app: 'APP LAUNCH',
    execute_macro: 'MACRO',
    search_web_app: 'WEB OPEN',
    play_media: 'MEDIA',
    change_system_volume: 'VOLUME',
    control_media: 'MEDIA CONTROL',
    fetch_system_status: 'SYSTEM STATUS',
    fetch_battery_status: 'BATTERY',
    search_local_files: 'FILE SEARCH',
    list_dir: 'DIRECTORY SCAN',
    read_file: 'FILE READ',
    write_file: 'FILE WRITE',
    create_folder: 'FOLDER CREATE',
    delete_path: 'DELETE',
    create_document: 'DOCUMENT',
    search_web_summary: 'WEB READ',
    inspect_and_interact_web: 'WEB AGENT',
    analyze_screen: 'SCREEN ANALYSIS',
    remember_fact: 'MEMORY WRITE',
    recall_facts: 'MEMORY RECALL',
    forget_fact: 'MEMORY ERASE'
  };

  displayActions(actions) {
    for (const action of actions || []) {
      const verdict = action.decision === 'denied' ? 'BLOCKED BY POLICY'
        : action.decision === 'cancelled' ? 'DECLINED'
        : 'EXECUTED';
      const label = FridayApp.ACTION_LABELS[action.tool] || action.tool.replace(/_/g, ' ').toUpperCase();
      const summary = String(action.summary || 'done').split('\n')[0].slice(0, 140);
      this.uiManager.appendActionNote(`${verdict} — ${label}: ${summary}`);
      this.logEvent(`${action.tool} ${action.decision}`);
    }
  }

  async resolveConfirmation(token, approved) {
    soundFX.playClick();
    this.uiManager.updateVoiceUIStatus('thinking');
    const thinkingId = this.uiManager.showThinkingIndicator();
    try {
      const result = await runAgent([], {
        confirmToken: approved ? token : null,
        cancelToken: approved ? null : token
      });
      this.processAgentResult(result, thinkingId, null);
    } catch (err) {
      console.warn('Confirmation error:', err && err.message);
      this.uiManager.resolveThinkingIndicator(thinkingId, 'I could not complete that action, Boss.');
      this.uiManager.updateVoiceUIStatus('standby');
    }
  }

  /* Honest offline fallback - used ONLY when the neural link fails. */
  localReply(clean) {
    const t = String(clean || '').toLowerCase();

    if (/\b(battery|power level)\b/.test(t)) {
      const battery = this.telemetryMonitor ? this.telemetryMonitor.battery : null;
      return battery
        ? `Battery is at ${Math.round(battery.level * 100)} percent, Boss.`
        : 'Battery data is unavailable on this device, Boss.';
    }
    if (/\b(time|clock)\b/.test(t)) {
      return `It is ${new Date().toLocaleTimeString()}, Boss.`;
    }
    if (/\b(network|connection|latency|link)\b/.test(t)) {
      return this.lastLinkHealth
        ? `Link latency is about ${this.lastLinkHealth.latencyMs} milliseconds, Boss.`
        : 'No link telemetry available, Boss.';
    }
    return "I couldn't reach my core systems for that, Boss.";
  }

  speakAndLog(text) {
    this.uiManager.appendChatMessage('friday', text);
    this.voiceEngine.speak(text);
  }

  /* ------------------------------------------------------------------------
     CLOCK
     ------------------------------------------------------------------------ */
  startClockTicker() {
    const update = () => {
      const now = new Date();
      this.clockDisplay.textContent = now.toTimeString().split(' ')[0];
    };
    update();
    setInterval(update, 1000);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.fridayApp = new FridayApp();
});
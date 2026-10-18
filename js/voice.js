/* ==========================================================================
   F.R.I.D.A.Y. // VOICE ENGINE (real, always-on wake word)
   --------------------------------------------------------------------------
   Wake word       : the mic is always hot. Say "Friday" (or "hey Friday")
                     followed by your command, or just "Friday" and then speak
                     within the awake window. Everything else is ignored.
   Speech-to-text  : Web Speech API (SpeechRecognition, Chromium-family).
                     Chromium's recogniser streams audio to Google's speech
                     servers and fails with 'network' forever when that
                     service is unreachable (offline, region-blocked, corporate
                     proxy). After repeated network failures the engine falls
                     back to server-side transcription: the already-open mic
                     stream is recorded with a silence-detecting VAD and each
                     utterance is POSTed to /api/stt (Groq Whisper).
   Text-to-speech  : ElevenLabs via /api/tts, with the browser's own speech
                     synthesis as an automatic fallback.
   Echo control    : recognition pauses while F.R.I.D.A.Y. is speaking so she
                     never hears her own voice.
   Visualizer feed : a real AnalyserNode tapped from the microphone stream
                     (ambient) and from the played TTS audio (while speaking).
   ========================================================================== */

import { synthesizeSpeech } from './ai-client.js';

// Anchored at the start: the wake word must lead the utterance. This keeps
// ambient noise and TV speech ("...on Friday...") from burning API quota.
// Wake word must lead the utterance (blocks ambient noise burning quota).
const WAKE_WORD = /^(hey\s+|ok(?:ay)?\s+|hi\s+|hello\s+)?friday\b/i;
const AWAKE_WINDOW_MS = 8000;

export class VoiceEngine {
  constructor() {
    this.isListening = false;
    this.isSpeaking = false;
    this.voiceOutputEnabled = true;
    this.micPermission = 'prompt';
    this.sttSupported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
    this.synthesis = window.speechSynthesis || null;

    this.onStatusChangeCallback = null;
    this.onTranscriptCallback = null;

    this.recognition = null;
    this.recognizing = false;

    // Always-on wake word state.
    this.ambientEnabled = false;
    this.awaitingCommand = false;         // wake word heard, command pending
    this.awaitingTimer = null;
    this.restartTimer = null;
    this.manualStop = false;

    // STT mode. 'webspeech' uses SpeechRecognition; repeated 'network' errors
    // (Google's speech service unreachable) switch us to 'server', which
    // records the mic locally and transcribes via /api/stt.
    this.sttMode = 'webspeech';
    this.networkFailures = 0;
    this.serverSttActive = false;
    this.vadNoiseFloor = 8;

    this.audioCtx = null;
    this.analyser = null;
    this.freqBuffer = new Uint8Array(32);
    this._emptyBuffer = new Uint8Array(32);
    this.micStream = null;
    this.micSource = null;

    this.currentAudio = null;
    this.currentAudioUrl = null;
    this.currentAudioSource = null;
    this.speakToken = 0;

    this.initAudioGraph();
    this.initRecognition();
  }

  /* ----------------------------------------------------------------- AUDIO */
  initAudioGraph() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.audioCtx = new Ctx();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 128;
      this.analyser.smoothingTimeConstant = 0.8;
      this.freqBuffer = new Uint8Array(this.analyser.frequencyBinCount);
    } catch (e) {
      console.warn('AudioContext unavailable:', e && e.message);
    }
  }

  resumeAudio() {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  getFrequencyData() {
    if (!this.analyser || (!this.isSpeaking && !this.isListening)) {
      return this._emptyBuffer;
    }
    this.analyser.getByteFrequencyData(this.freqBuffer);
    return this.freqBuffer;
  }

  async enableMic() {
    if (this.micStream) return true;
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      this.micPermission = 'unsupported';
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.micStream = stream;
      this.micPermission = 'granted';
      if (this.audioCtx && this.analyser) {
        this.resumeAudio();
        this.micSource = this.audioCtx.createMediaStreamSource(stream);
        this.micSource.connect(this.analyser); // analyse only (no destination -> no echo)
      }
      return true;
    } catch (e) {
      this.micPermission = (e && e.name === 'NotAllowedError') ? 'denied' : 'error';
      console.warn('Microphone unavailable:', e && e.message);
      return false;
    }
  }

  disableMic() {
    if (this.micSource) {
      try { this.micSource.disconnect(); } catch (e) { /* noop */ }
      this.micSource = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
      this.micStream = null;
    }
  }

  /* ------------------------------------------------------------------- STT */
  initRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => { this.recognizing = true; };

    recognition.onresult = (event) => {
      this.networkFailures = 0;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (!event.results[i].isFinal) continue;
        const transcript = event.results[i][0].transcript.trim();
        if (transcript) this._handleUtterance(transcript);
      }
    };

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.micPermission = 'denied';
        this.ambientEnabled = false;
        this.isListening = false;
        this.disableMic();
        this._emit('denied');
      } else if (event.error === 'network') {
        // Chromium's speech service is unreachable; after two failures give
        // up on it and transcribe through the server instead.
        this.networkFailures++;
        if (this.networkFailures >= 2) this._switchToServerStt();
        else this._scheduleRestart(3000);
      }
      // 'no-speech' / 'aborted' are normal in continuous mode.
    };

    recognition.onend = () => {
      this.recognizing = false;
      if (this.sttMode !== 'webspeech') return;
      if (this.ambientEnabled && !this.manualStop) {
        // Chromium ends the session after silence; keep the wake word hot
        // with a minimal gap so spoken fragments stay unbroken.
        this._scheduleRestart(150);
      } else if (!this.ambientEnabled && !this.isSpeaking) {
        this.isListening = false;
        this.disableMic();
      }
    };

    this.recognition = recognition;
  }

  _scheduleRestart(delay) {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => this._startRecognition(), delay);
  }

  _startRecognition() {
    if (!this.recognition || this.recognizing) return;
    if (this.sttMode !== 'webspeech' || !this.ambientEnabled || this.manualStop) return;
    try { this.recognition.start(); } catch (e) { /* already started */ }
  }

  /* ------------------------------------------------------------ SERVER STT */
  /* Fallback transcriber for networks where Chromium's speech service is
     unreachable. Records the already-open mic stream, segments utterances
     with an energy VAD, and POSTs each clip to /api/stt (Groq Whisper). */
  _switchToServerStt() {
    if (this.sttMode === 'server') return;
    if (typeof MediaRecorder === 'undefined' || !this.micStream) {
      this._scheduleRestart(5000); // no fallback available; keep retrying
      return;
    }
    this.sttMode = 'server';
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    if (this.recognition && this.recognizing) {
      try { this.recognition.stop(); } catch (e) { /* noop */ }
      this.recognizing = false;
    }
    this._startServerStt();
  }

  _startServerStt() {
    if (this.serverSttActive || !this.micStream || this.sttMode !== 'server') return;
    this.serverSttActive = true;
    this._serverSttLoop();
  }

  async _serverSttLoop() {
    while (this.ambientEnabled && this.sttMode === 'server') {
      try {
        const text = await this._captureUtterance();
        if (this.ambientEnabled && text) this._handleUtterance(text);
        // Never spin: capture returns without yielding while she speaks.
        if (!text) await this._sleep(250);
      } catch (e) {
        if (!this.ambientEnabled) break;
        await this._sleep(1500);
      }
    }
    this.serverSttActive = false;
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /* Average magnitude of the voice band of the live mic spectrum. */
  _readEnergy() {
    if (!this.analyser) return 0;
    this.analyser.getByteFrequencyData(this.freqBuffer);
    const bins = Math.min(16, this.freqBuffer.length);
    let sum = 0;
    for (let i = 0; i < bins; i++) sum += this.freqBuffer[i];
    return sum / bins;
  }

  /* Waits for speech, records one utterance, returns its transcript (or ''). */
  async _captureUtterance() {
    const SAMPLE_MS = 100;
    const SPEECH_MARGIN = 14;       // energy must clear the room floor by this
    const SILENCE_HOLD_MS = 1200;   // quiet for this long -> utterance ended
    const MIN_SPEECH_MS = 300;      // discard blips
    const MAX_UTTERANCE_MS = 15000;

    // Wait out Friday's own reply before listening again, then sit in the
    // noise until something clears the (slowly tracked) room floor.
    while (this.ambientEnabled && this.isSpeaking) await this._sleep(200);
    while (this.ambientEnabled && !this.isSpeaking) {
      const e = this._readEnergy();
      this.vadNoiseFloor = (this.vadNoiseFloor * 0.95) + (e * 0.05);
      if (e > this.vadNoiseFloor + SPEECH_MARGIN && e > 22) break;
      await this._sleep(SAMPLE_MS);
    }
    if (!this.ambientEnabled || this.isSpeaking) return '';

    const chunks = [];
    const recorder = new MediaRecorder(this.micStream);
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.start();
    const startedAt = Date.now();
    let speechMs = 0;
    let lastLoud = Date.now();

    while (this.ambientEnabled && Date.now() - startedAt < MAX_UTTERANCE_MS) {
      if (this.isSpeaking) break; // Friday started replying; cut the capture
      const e = this._readEnergy();
      if (e > this.vadNoiseFloor + SPEECH_MARGIN) {
        lastLoud = Date.now();
        speechMs += SAMPLE_MS;
      } else if (Date.now() - lastLoud >= SILENCE_HOLD_MS && speechMs >= MIN_SPEECH_MS) {
        break;
      }
      await this._sleep(SAMPLE_MS);
    }

    try { recorder.stop(); } catch (e) { /* noop */ }
    await stopped;
    if (!this.ambientEnabled || speechMs < MIN_SPEECH_MS || this.isSpeaking) return '';

    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    if (!blob.size) return '';
    const res = await fetch('/api/stt', {
      method: 'POST',
      headers: { 'Content-Type': blob.type },
      body: blob
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.error || `STT HTTP ${res.status}`);
    }
    const data = await res.json();
    return String(data.text || '').trim();
  }

  /**
   * Wake word router. "Friday, open notepad" runs immediately; a bare
   * "Friday" opens an awake window for the command that follows.
   * Any wake-word command spoken while she is talking interrupts her and
   * runs — the user can change direction mid-reply (barge-in).
   */
  _handleUtterance(transcript) {
    const match = WAKE_WORD.exec(transcript);

    if (this.isSpeaking) {
      if (!match) return; // her own voice or ambient chatter — ignore
      const command = transcript.slice(match.index + match[0].length)
        .replace(/^[,\s]+/, '').trim();
      this.stopSpeaking(); // interrupts playback, emits ambient
      if (command) {
        this._emit('thinking');
        if (typeof this.onTranscriptCallback === 'function') this.onTranscriptCallback(command);
      }
      return;
    }

    if (match) {
      const command = transcript.slice(match.index + match[0].length)
        .replace(/^[,\s]+/, '').trim();
      if (command) {
        this._clearAwaiting();
        this._emit('thinking');
        if (typeof this.onTranscriptCallback === 'function') this.onTranscriptCallback(command);
      } else {
        this._clearAwaiting();
        this.awaitingCommand = true;
        this._emit('awaiting');
        this.awaitingTimer = setTimeout(() => {
          this.awaitingCommand = false;
          this._emit('ambient');
        }, AWAKE_WINDOW_MS);
      }
    } else if (this.awaitingCommand && transcript.trim()) {
      this._clearAwaiting();
      this._emit('thinking');
      if (typeof this.onTranscriptCallback === 'function') this.onTranscriptCallback(transcript);
    }
    // No wake word and no awake window: ambient chatter is ignored.
  }

  _clearAwaiting() {
    this.awaitingCommand = false;
    if (this.awaitingTimer) { clearTimeout(this.awaitingTimer); this.awaitingTimer = null; }
  }

  /* Always-on entry point: hot mic + continuous wake word detection. */
  async startAmbientListening() {
    if (!this.sttSupported) { this._emit('unsupported'); return false; }
    this.ambientEnabled = true;
    this.manualStop = false;
    const ok = await this.enableMic();
    if (!ok) {
      this._emit(this.micPermission === 'denied' ? 'denied' : 'standby');
      return false;
    }
    this.isListening = true;
    this._emit('ambient');
    if (this.sttMode === 'server') this._startServerStt();
    else this._startRecognition();
    return true;
  }

  /* Full manual stop: turns the wake word off (nothing calls this by default). */
  stopListening() {
    this.manualStop = true;
    this.ambientEnabled = false;
    this._clearAwaiting();
    if (this.recognition && this.recognizing) {
      try { this.recognition.stop(); } catch (e) { /* noop */ }
    }
    this.disableMic();
    this.isListening = false;
    this._emit('standby');
  }

  /* ------------------------------------------------------------------- TTS */
  async speak(text) {
    if (!this.voiceOutputEnabled || !text) return;
    const token = ++this.speakToken;
    this.resumeAudio();

    try {
      const blob = await synthesizeSpeech(text);
      if (token !== this.speakToken) return;
      await this._playBlob(blob, token);
    } catch (e) {
      if (token !== this.speakToken) return;
      console.warn('ElevenLabs TTS unavailable, using browser speech:', e && e.message);
      this._speakWebSpeech(text, token);
    }
  }

  async _playBlob(blob, token) {
    this._cleanupAudio();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    this.currentAudio = audio;
    this.currentAudioUrl = url;

    if (this.audioCtx && this.analyser) {
      this.resumeAudio();
      try {
        const source = this.audioCtx.createMediaElementSource(audio);
        source.connect(this.audioCtx.destination); // audible
        source.connect(this.analyser);             // drives the visualiser
        this.currentAudioSource = source;
      } catch (e) {
        console.warn('Could not tap TTS audio for the visualiser:', e && e.message);
      }
    }

    await new Promise((resolve) => {
      audio.onplay = () => {
        if (token === this.speakToken) {
          // Recognition stays hot: the user can barge in with "Friday, stop".
          this.isSpeaking = true; this._emit('speaking');
        }
      };
      audio.onended = () => {
        if (token === this.speakToken) {
          this.isSpeaking = false; this._cleanupAudio(); this._emit('ambient');
          this._scheduleRestart(200);
        }
        resolve();
      };
      audio.onerror = () => {
        if (token === this.speakToken) {
          this.isSpeaking = false; this._cleanupAudio(); this._emit('ambient');
          this._scheduleRestart(200);
        }
        resolve();
      };
      audio.play().catch(() => resolve());
    });
  }

  _speakWebSpeech(text, token) {
    if (!this.synthesis) { this.isSpeaking = false; this._emit('ambient'); return; }
    this.synthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.pitch = 1.05;
    utterance.rate = 1.05;
    utterance.onstart = () => {
      if (token === this.speakToken) { this.isSpeaking = true; this._emit('speaking'); }
    };
    utterance.onend = () => {
      if (token === this.speakToken) { this.isSpeaking = false; this._emit('ambient'); }
    };
    utterance.onerror = () => {
      if (token === this.speakToken) { this.isSpeaking = false; this._emit('ambient'); }
    };
    this.synthesis.speak(utterance);
  }

  stopSpeaking() {
    this.speakToken++;
    if (this.currentAudio) {
      try { this.currentAudio.pause(); } catch (e) { /* noop */ }
    }
    this._cleanupAudio();
    if (this.synthesis) this.synthesis.cancel();
    this.isSpeaking = false;
    this._emit('ambient');
  }

  _cleanupAudio() {
    if (this.currentAudioSource) {
      try { this.currentAudioSource.disconnect(); } catch (e) { /* noop */ }
      this.currentAudioSource = null;
    }
    if (this.currentAudio) {
      this.currentAudio.onplay = null;
      this.currentAudio.onended = null;
      this.currentAudio.onerror = null;
      this.currentAudio = null;
    }
    if (this.currentAudioUrl) {
      URL.revokeObjectURL(this.currentAudioUrl);
      this.currentAudioUrl = null;
    }
  }

  cancelSpeech() {
    this.stopSpeaking();
  }

  _emit(status) {
    if (typeof this.onStatusChangeCallback === 'function') this.onStatusChangeCallback(status);
  }
}
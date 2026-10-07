/* ==========================================================================
   F.R.I.D.A.Y. // UI MANAGER — chat stream + voice status rendering
   The header badge (statusText) is owned by the app and reflects the real
   neural-link state, so it is intentionally NOT touched here.
   ========================================================================== */

export class UIManager {
  constructor() {
    this.chatStream = document.getElementById('chatStream');
    this.btnMic = document.getElementById('btnMic');
    this.voicePulsar = document.getElementById('voicePulsar');
    this.reactorState = document.getElementById('reactorState');
    this.voiceBannerText = document.getElementById('voiceBannerText');
  }

  appendChatMessage(author, text) {
    if (!this.chatStream) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-msg msg-${author}`;

    const authorDiv = document.createElement('div');
    authorDiv.className = 'msg-author';
    authorDiv.textContent = author === 'friday' ? 'F.R.I.D.A.Y.' : 'YOU (BOSS)';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'msg-content';
    contentDiv.textContent = text;

    const timeDiv = document.createElement('div');
    timeDiv.className = 'msg-time';
    timeDiv.textContent = new Date().toLocaleTimeString();

    msgDiv.appendChild(authorDiv);
    msgDiv.appendChild(contentDiv);
    msgDiv.appendChild(timeDiv);

    this.chatStream.appendChild(msgDiv);
    this.chatStream.scrollTop = this.chatStream.scrollHeight;
  }

  showThinkingIndicator() {
    if (!this.chatStream) return null;
    const id = `thinking_${crypto.randomUUID()}`;
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-msg msg-friday thinking';
    msgDiv.id = id;

    const authorDiv = document.createElement('div');
    authorDiv.className = 'msg-author';
    authorDiv.textContent = 'F.R.I.D.A.Y.';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'msg-content';
    contentDiv.innerHTML = `<span>Processing</span><span class="thinking-dots"><span></span><span></span><span></span></span>`;

    const timeDiv = document.createElement('div');
    timeDiv.className = 'msg-time';
    timeDiv.textContent = 'THINKING...';

    msgDiv.appendChild(authorDiv);
    msgDiv.appendChild(contentDiv);
    msgDiv.appendChild(timeDiv);

    this.chatStream.appendChild(msgDiv);
    this.chatStream.scrollTop = this.chatStream.scrollHeight;
    return id;
  }

  resolveThinkingIndicator(id, finalResponse) {
    const thinkingEl = document.getElementById(id);
    if (thinkingEl) {
      thinkingEl.className = 'chat-msg msg-friday';
      const contentEl = thinkingEl.querySelector('.msg-content');
      if (contentEl) contentEl.textContent = finalResponse;
      const timeEl = thinkingEl.querySelector('.msg-time');
      if (timeEl) timeEl.textContent = new Date().toLocaleTimeString();
    } else {
      this.appendChatMessage('friday', finalResponse);
    }
  }

  /** Small system-style note describing an action the agent took or blocked. */
  appendActionNote(text) {
    if (!this.chatStream) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-msg msg-action';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'msg-content';
    contentDiv.textContent = text;

    msgDiv.appendChild(contentDiv);
    this.chatStream.appendChild(msgDiv);
    this.chatStream.scrollTop = this.chatStream.scrollHeight;
  }

  /**
   * Renders a destructive-action confirmation with Confirm / Cancel buttons.
   * Buttons disable after the choice; the chosen one is highlighted.
   */
  appendConfirmation(description, onConfirm, onCancel) {
    if (!this.chatStream) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-msg msg-confirm';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'msg-content';
    contentDiv.textContent = description;

    const btnRow = document.createElement('div');
    btnRow.className = 'confirm-row';

    const yes = document.createElement('button');
    yes.className = 'confirm-btn confirm-yes';
    yes.textContent = 'CONFIRM';

    const no = document.createElement('button');
    no.className = 'confirm-btn confirm-no';
    no.textContent = 'CANCEL';

    const settle = (chosen, other, handler) => {
      chosen.classList.add('chosen');
      chosen.disabled = true;
      other.disabled = true;
      msgDiv.classList.add('settled');
      handler();
    };
    yes.addEventListener('click', () => settle(yes, no, onConfirm));
    no.addEventListener('click', () => settle(no, yes, onCancel));

    btnRow.appendChild(yes);
    btnRow.appendChild(no);
    msgDiv.appendChild(contentDiv);
    msgDiv.appendChild(btnRow);
    this.chatStream.appendChild(msgDiv);
    this.chatStream.scrollTop = this.chatStream.scrollHeight;
  }

  updateVoiceUIStatus(status) {
    const active = status === 'awake' || status === 'speaking' || status === 'thinking' || status === 'awaiting';
    if (this.btnMic) this.btnMic.classList.toggle('listening', active);
    if (this.voicePulsar) {
      this.voicePulsar.className = 'voice-indicator-pulsar ' + (status === 'awaiting' ? 'listening' : status);
    }

    if (status === 'ambient') {
      if (this.reactorState) this.reactorState.textContent = 'STANDBY';
      if (this.voiceBannerText) this.voiceBannerText.textContent = "Wake word active — say 'Friday' followed by your command, Boss.";
    } else if (status === 'awaiting') {
      if (this.reactorState) this.reactorState.textContent = 'LISTENING';
      if (this.voiceBannerText) this.voiceBannerText.textContent = 'Awake. Speak your command, Boss.';
    } else if (status === 'awake') {
      if (this.reactorState) this.reactorState.textContent = 'LISTENING';
      if (this.voiceBannerText) this.voiceBannerText.textContent = 'Listening... speak your command.';
    } else if (status === 'thinking') {
      if (this.reactorState) this.reactorState.textContent = 'PROCESSING';
      if (this.voiceBannerText) this.voiceBannerText.textContent = 'Processing your request...';
    } else if (status === 'speaking') {
      if (this.reactorState) this.reactorState.textContent = 'RESPONDING';
      if (this.voiceBannerText) this.voiceBannerText.textContent = 'F.R.I.D.A.Y. responding...';
    } else if (status === 'denied') {
      if (this.reactorState) this.reactorState.textContent = 'MIC BLOCKED';
      if (this.voiceBannerText) this.voiceBannerText.textContent = 'Microphone blocked. Allow mic access in the browser to use voice control.';
    } else if (status === 'unsupported') {
      if (this.reactorState) this.reactorState.textContent = 'VOICE N/A';
      if (this.voiceBannerText) this.voiceBannerText.textContent = 'Speech recognition is unavailable in this browser. Type your commands below.';
    } else {
      if (this.reactorState) this.reactorState.textContent = 'STANDBY';
      if (this.voiceBannerText) this.voiceBannerText.textContent = "Say 'Friday' followed by your command, or type below.";
    }
  }
}
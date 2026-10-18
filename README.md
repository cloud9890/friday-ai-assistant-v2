# ⚡ F.R.I.D.A.Y. // Stark Tactical AI Assistant

A futuristic Stark-style tactical HUD that talks to a **real** AI model, runs a
**real** voice loop, and reports **real** device telemetry. Every simulated or
fictional value has been removed — when a source is unavailable the interface
says so instead of inventing data.

---

## What is real now

- **AI replies** — same-origin `/api/agent` + `/api/chat` proxy (keys stay
  server-side). **Flow: cloud first → local fallback** — the **cloud provider**
  (**OpenRouter** by default; any OpenAI-compatible endpoint) is
  always tried first; if it is unreachable, times out, errors, or is
  unconfigured, the proxy automatically retries the **local Ollama model** in
  the same request so the conversation keeps flowing. The reply reports which
  provider served it. Set `AI_PROVIDER=ollama` only to force local-first
  (offline work).
- **Agentic control of your PC** — the model can run real tools through a
  kernel-gated agent loop (`/api/agent`): launch desktop apps, create folders,
  write/read files, search files, create `.docx` documents, control
  volume/media, and report live CPU/memory/battery. **Destructive actions
  (deleting a file or folder) always pause and require your explicit CONFIRM
  in the UI.**
- **Native app UI control** — `control_desktop_app` drives real Windows apps
  through the OS accessibility layer (UI Automation), with a computer-use
  discipline: list running apps, observe a window's semantic element tree
  (roles, names, values, states, advertised patterns), act on elements by
  index (`click`, `setValue`, `performAction`), and verify every effect from
  the read-back each action returns (`setValue` confirms the text actually
  landed; clicks report the new window title and keyboard focus). Window
  screenshots with vision analysis are the fallback for UIs the tree can't
  see. Shell windows (cmd/PowerShell) are hard-blocked from automation —
  both in the policy kernel and again at execution time.
- **Long-term memory** — Friday remembers facts and preferences across
  restarts ("remember that…", "what do you remember about me?"), plus an
  episodic log of recent interactions injected into every conversation.
- **Proactive reminders & tasks** — Friday can act on her own schedule:
  "remind me in 10 minutes to stretch" or "remind me at 17:30 to call Pepper".
  Jobs persist in `data/jobs.json` and **survive a restart** (anything that
  came due while the server was down fires on boot). When one lands you get a
  native Windows toast, a live HUD alert on the SCHEDULE card, and a spoken
  line. Manage them by voice — *"what's on my schedule?"*, *"cancel the
  stretch reminder"* — and `send_notification` covers one-off alerts. The
  timestamp is certified by the policy kernel (`schedule:write`) before
  anything is stored.
- **Screen awareness** — toggle SHARE SCREEN in the header and Friday can see
  your display: "look at my screen and read this error".
- **Streaming responses** — replies stream in token-by-token and every tool
  run shows live status in the HUD, so nothing ever looks frozen.
- **Barge-in** — say "Friday, stop" while she is speaking and she shuts up
  mid-sentence.
- **Skill plugin system** — every capability is one file in `server/skills/`
  declaring its own schema, risk level and policy; the registry generates the
  tool catalog, the kernel permission table and execution dispatch from it.
- **Agentic web** — a real Puppeteer-driven Chrome window with a
  control-browser-style discipline: ARIA-grade snapshots (roles, accessible
  names, checked/selected/expanded states, iframe content) carry **stable
  element IDs** that survive DOM re-renders, so the model never mis-clicks a
  moved target. Actions use real mouse/keyboard events and wait on what the
  page actually does (navigation or network settle) instead of blind sleeps;
  `target="_blank"` popups are adopted automatically and every action returns
  an observation line (URL/title before → after) so the agent verifies its own
  effects. Coordinate clicks (`clickAt`) cover canvas/visual targets,
  `extract` reads article text, screenshots are vision-analysed, and a
  read-before-act / verify-after-every-action workflow is baked into the
  system prompt. Set `WEB_AGENT_HEADLESS=1` to hide the Chrome window.
- **Always-on wake word** — the mic is hot the moment the page loads (no
  button). Say **"Friday"** followed by your command — e.g. *"Friday, open
  notepad"* — or just *"Friday"* and speak within 8 seconds. Everything after
  the wake word goes through the agent and is acted on. F.R.I.D.A.Y. pauses
  listening while she speaks so she never hears her own voice.
- **Voice input** — Web Speech API `SpeechRecognition` (Chromium-family). If
  Chromium's speech service is unreachable (offline or region-blocked network —
  it fails with endless `network` errors), the engine automatically falls back
  to **server-side transcription**: the mic is recorded locally with a
  silence-detecting VAD and each utterance is transcribed by Groq Whisper via
  `POST /api/stt` (uses a `GROQ_API_KEY`; optional `STT_MODEL`
  override).
- **Voice output** — **ElevenLabs** via `/api/tts`, with the browser's own
  `speechSynthesis` as an automatic fallback.
- **Arc reactor / spectrum** — a real `AnalyserNode` fed by the live microphone
  (while listening) and by the played TTS audio (while speaking). No synthetic
  frequency data.
- **System power & compute** — Battery API, `navigator.hardwareConcurrency`,
  `navigator.deviceMemory`, and `performance.memory` (JS heap).
- **Network & environment** — Network Information API, real round-trip latency
  to the proxy, and Geolocation (permission-gated).
- **System diagnostics** — a real check runner reporting genuine results.
- **Directives** — persisted in `localStorage`.

## Security

API keys live **only on the server**. `vite.config.js` refuses to start if a
secret-like variable is exposed to the client (i.e. a `VITE_`-prefixed secret),
so no key can ever be bundled into the browser.

Agent capabilities are gated by the **policy kernel** (`server/security/`):
the model can *request* an action, but only the kernel *authorises* it. Every
capability is a **skill file** (`server/skills/`) that declares its own risk,
permissions and policy hints — the registry generates the permission table, so
ungated capabilities cannot exist. Filesystem access is limited to
Desktop/Documents with traversal, UNC and sensitive-location rejection; only
vetted applications can be launched; the web agent may only visit public
http(s) hosts (SSRF-protected); every decision is appended to
`data/audit.jsonl`; and `/api/*` rejects non-local Host headers and
cross-site Origins. Every `/api/*` request (other than the liveness route)
also requires a local session cookie — an HttpOnly, `SameSite=Strict`
`friday_sid` token issued to the same-origin UI when it loads. Deletion
requires an explicit user confirmation in the UI
before it executes, and proactive reminders are time-certified by the same
kernel (`schedule:write`: an ISO timestamp or a bounded delay, never a past
time). Policy regression tests: `npm test`.

## Setup

```bash
npm install
```

Copy `.env.example` to `.env` and configure at least one provider:

```env
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your_openrouter_api_key_here
OPENROUTER_MODEL=nvidia/nemotron-3-ultra-550b-a55b:free

# Optional ElevenLabs voice (else the browser voice is used)
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
ELEVENLABS_VOICE_ID=your_elevenlabs_voice_id_here

# Optional: voice STT uses a Groq key (OpenRouter has no STT), and Groq is the
# automatic fallback for vision. Vision's primary is OpenRouter, reusing
# OPENROUTER_API_KEY — see Vision below.
# GROQ_API_KEY=your_groq_api_key_here

# Or run fully local with Ollama instead of the cloud link
# AI_PROVIDER=ollama
# OLLAMA_BASE_URL=http://localhost:11434
```

Then start it:

```bash
npm run dev
```

Open **http://127.0.0.1:5173/** (Chrome or Edge recommended).

### Build

```bash
npm run build
npm run preview
```

## Browser support

- **Chrome / Edge** — full feature set (speech recognition, `performance.memory`,
  Battery API, Network Information API).
- **Firefox / Safari** — typed commands and browser TTS work; unsupported
  metrics render as `N/A`.

## Server endpoints

| Route | Method | Purpose |
|---|---|---|
| `/api/agent` | POST | Agentic turn: model reasoning + kernel-gated tool execution |
| `/api/chat` | POST | Plain chat completion (cloud / Ollama) |
| `/api/tts` | POST | ElevenLabs speech audio (audio/mpeg) |
| `/api/health` | GET | Provider status; also used to measure link latency |
| `/api/memory` | GET | Long-term memory snapshot for the HUD card |
| `/api/tasks` | GET | Pending reminders for the HUD schedule card |
| `/api/notifications` | GET | Proactive alerts newer than `?since=<id>` (no `since` = seed only) |

## Project layout

```
index.html              Stark HUD markup
style.css               HUD styling & animations
app.js                  Core controller (agent client, voice, screen share)
ui-manager.js           Chat / voice-status / confirmation rendering
sound-fx.js             Web Audio SFX synthesizer
vite-plugin-ai.js       Same-origin AI/TTS proxy (keys never reach the client)
vite-plugin-agent.js    /api/agent — kernel-gated, SSE-streaming agent endpoint
js/ai-client.js         Browser client for the proxy + streaming agent
js/voice.js             Always-on wake word engine (STT + TTS + barge-in)
js/screen.js            Screen-share frame capture for vision
js/visualizer.js        Arc reactor + spectrum canvas
js/telemetry.js         Real browser metrics
js/diagnostics.js       Real full-diagnostic runner
js/directives.js        Task log (localStorage persistence)
server/skills/          One file per capability — the plugin registry
server/agent/           ReAct loop, streaming, system prompt
server/security/        Policy kernel, path/network/app policies, audit trail
server/memory/          Persistent long-term memory (facts + episodes)
server/web-agent/       Puppeteer browser automation engine
server/lib/             Providers (cloud/Ollama), app launcher, docx writer,
                        paths, scheduler (proactive jobs), notifier (toasts)
test/                   Policy, registry and memory regression tests (npm test)
```
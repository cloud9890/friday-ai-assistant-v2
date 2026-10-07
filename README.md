# ⚡ F.R.I.D.A.Y. // Stark Tactical AI Assistant

A futuristic Stark-style tactical HUD that talks to a **real** AI model, runs a
**real** voice loop, and reports **real** device telemetry. Every simulated or
fictional value has been removed — when a source is unavailable the interface
says so instead of inventing data.

---

## What is real now

- **AI replies** — same-origin `/api/agent` + `/api/chat` proxy (keys stay
  server-side). **Flow: cloud first → local fallback** — **Groq** (cloud) is
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
- **Long-term memory** — Friday remembers facts and preferences across
  restarts ("remember that…", "what do you remember about me?"), plus an
  episodic log of recent interactions injected into every conversation.
- **Screen awareness** — toggle SHARE SCREEN in the header and Friday can see
  your display: "look at my screen and read this error".
- **Streaming responses** — replies stream in token-by-token and every tool
  run shows live status in the HUD, so nothing ever looks frozen.
- **Barge-in** — say "Friday, stop" while she is speaking and she shuts up
  mid-sentence.
- **Skill plugin system** — every capability is one file in `server/skills/`
  declaring its own schema, risk level and policy; the registry generates the
  tool catalog, the kernel permission table and execution dispatch from it.
- **Agentic web** — a real Puppeteer-driven Chrome window: the model can
  navigate, read simplified DOMs, click, type, scroll, extract article text,
  and take (visually analysed) screenshots until a web task is complete.
- **Always-on wake word** — the mic is hot the moment the page loads (no
  button). Say **"Friday"** followed by your command — e.g. *"Friday, open
  notepad"* — or just *"Friday"* and speak within 8 seconds. Everything after
  the wake word goes through the agent and is acted on. F.R.I.D.A.Y. pauses
  listening while she speaks so she never hears her own voice.
- **Voice input** — Web Speech API `SpeechRecognition` (Chromium-family).
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
cross-site Origins. Deletion requires an explicit user confirmation in the UI
before it executes. Policy regression tests: `npm test`.

## Setup

```bash
npm install
```

Copy `.env.example` to `.env` and configure at least one provider:

```env
AI_PROVIDER=groq
GROQ_API_KEY=your_groq_api_key_here

# Optional ElevenLabs voice (else the browser voice is used)
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
ELEVENLABS_VOICE_ID=your_elevenlabs_voice_id_here

# Or run fully local with Ollama instead of Groq
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
| `/api/chat` | POST | Plain chat completion (Groq / Ollama) |
| `/api/tts` | POST | ElevenLabs speech audio (audio/mpeg) |
| `/api/health` | GET | Provider status; also used to measure link latency |

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
server/lib/             Providers (Groq/Ollama), app launcher, docx writer, paths
test/                   Policy, registry and memory regression tests (npm test)
```
/* ==========================================================================
   F.R.I.D.A.Y. // Vite configuration
   --------------------------------------------------------------------------
   Registers the same-origin AI proxy (keys stay server-side) and refuses to
   start if a secret-like variable would be inlined into the client bundle.
   ========================================================================== */

import { defineConfig, loadEnv } from 'vite';
import fridayAiPlugin from './vite-plugin-ai.js';
import fridayAgentPlugin from './vite-plugin-agent.js';

const SECRETISH = /(API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // Phase S1 guard: a VITE_-prefixed secret is a public secret. Fail fast.
  const offenders = Object.keys(env).filter(
    (key) => key.startsWith('VITE_') && SECRETISH.test(key)
  );
  if (offenders.length > 0) {
    throw new Error(
      `[FRIDAY/S1] Refusing to start: secret-like variable(s) would be bundled into client code: ${offenders.join(', ')}. ` +
      `Remove the VITE_ prefix so the value stays server-side.`
    );
  }

  return {
    plugins: [fridayAiPlugin(env), fridayAgentPlugin(env)],
    server: {
      port: 5173,
      open: false
    }
  };
});
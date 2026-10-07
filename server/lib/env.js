/* ==========================================================================
   F.R.I.D.A.Y. // SERVER LIB — ENVIRONMENT ACCESS
   Single, server-side reader for configuration values.
   Phase 1 / S1: secrets are read here and never forwarded to the client.
   ========================================================================== */

import fs from 'fs';
import path from 'path';

/**
 * Reads a server-side environment value.
 * Precedence: process.env -> local .env file.
 * Returns null when unset. Never logs the value.
 */
export function readEnv(name) {
  const fromProcess = process.env[name];
  if (typeof fromProcess === 'string' && fromProcess.trim()) return fromProcess.trim();
  try {
    const envContent = fs.readFileSync(path.resolve('.env'), 'utf-8');
    const match = envContent.match(new RegExp(`(?:^|\\n)${name}=(.*)`));
    if (match) return match[1].trim().replace(/^["']|["']$/g, '');
  } catch (e) {}
  return null;
}
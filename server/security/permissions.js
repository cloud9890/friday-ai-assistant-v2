/* ==========================================================================
   F.R.I.D.A.Y. // SECURITY — TOOL PERMISSION MODEL
   The capability table is GENERATED from the skill registry
   (server/skills/): every skill declares its own risk, permissions and
   confirmation mode, so nothing can ship ungated. This module adds endpoint
   mapping and argument validation on top.
   ========================================================================== */

import { RISK, CONFIRMATION, PERMISSION } from './risk.js';
import { capabilityTable } from '../skills/registry.js';

export { PERMISSION };

const TOOL_SECURITY = capabilityTable();
export { TOOL_SECURITY, RISK, CONFIRMATION };

/** Endpoint path -> capability key. Used by the server gate. */
export const ENDPOINT_TO_TOOL = {
  '/api/open-app': 'open_desktop_app',
  '/api/save-file': 'create_document',
  '/api/system-volume': 'change_system_volume',
  '/api/media-control': 'control_media',
  '/api/system-stats': 'fetch_system_status',
  '/api/search-files': 'search_local_files',
  '/api/web-scrape': 'search_web_summary',
  '/api/web-agent': 'inspect_and_interact_web',
  '/api/play-media': 'play_media',
  '/api/execute-macro': 'execute_macro',
  '/api/vision': 'analyze_screen'
};

/** Endpoints that carry no authority and therefore skip policy evaluation. */
export const PUBLIC_ENDPOINTS = [
  '/api/auth/session',
  '/api/health',
  '/api/chat',
  '/api/tts'
];

export function getToolMetadata(name) {
  return TOOL_SECURITY[name] || null;
}

export function metadataForEndpoint(pathname) {
  const key = ENDPOINT_TO_TOOL[pathname];
  return key ? { key, meta: TOOL_SECURITY[key] } : null;
}

/**
 * Validates the shape of model-supplied arguments against the metadata schema.
 * Only the declared fields survive, so unexpected keys never reach executors.
 *
 * @returns {{ok: boolean, clean?: object, reason?: string}}
 */
export function validateInput(schema, args) {
  if (!schema) return { ok: true, clean: {} };
  const source = (args && typeof args === 'object' && !Array.isArray(args)) ? args : {};

  const clean = {};
  for (const [field, type] of Object.entries(schema)) {
    const value = source[field];
    if (value === undefined) continue;

    if (type === 'string' && typeof value !== 'string') {
      return { ok: false, reason: `field "${field}" must be a string` };
    }
    if (type === 'number' && typeof value !== 'number') {
      return { ok: false, reason: `field "${field}" must be a number` };
    }
    if (type === 'array' && !Array.isArray(value)) {
      return { ok: false, reason: `field "${field}" must be an array` };
    }
    clean[field] = value;
  }
  return { ok: true, clean };
}

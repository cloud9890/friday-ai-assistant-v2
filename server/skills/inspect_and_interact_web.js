/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — INSPECT AND INTERACT WEB (browser agent)
   Workflow discipline ported from the control-browser skill: read before
   acting, act only on IDs from the latest snapshot, verify the effect from
   the snapshot that comes back, never guess.
   ========================================================================== */

import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { handleWebAgent } from '../web-agent/engine.js';

export default {
  name: 'inspect_and_interact_web',
  description: [
    'Drives a real Chrome browser on live websites. Workflow discipline:',
    '1) navigate, then read the snapshot that comes back;',
    '2) act ONLY on element IDs present in the latest snapshot — never guess an ID;',
    '3) after every action verify the effect from the fresh snapshot and observation line that returns;',
    '4) if an element is missing, re-read with getDOM (optionally with query=) — do not retry blindly;',
    '5) use extract for long article text, screenshot (with a prompt) when you must SEE the page (canvas, images, layout), clickAt for targets that have no element ID (canvas, maps);',
    '6) one browser action at a time; chain navigate -> read -> act -> verify until the task is done.'
  ].join(' '),
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['navigate', 'getDOM', 'extract', 'click', 'clickAt', 'type', 'keypress', 'select', 'hover', 'scroll', 'wait', 'screenshot', 'back', 'forward', 'reload', 'openTab', 'closeTab', 'listTabs'] },
      url: { type: 'string' },
      elementId: { type: 'string' },
      text: { type: 'string' },
      submit: { type: 'boolean', description: 'For type: press Enter after typing (submits forms/searches).' },
      x: { type: 'number', description: 'For clickAt: viewport x coordinate in pixels.' },
      y: { type: 'number', description: 'For clickAt: viewport y coordinate in pixels.' },
      direction: { type: 'string', enum: ['down', 'up', 'top', 'bottom'] },
      mode: { type: 'string', enum: ['interactive', 'readable', 'full'] },
      query: { type: 'string' },
      keys: { type: 'string' },
      value: { type: 'string' },
      ms: { type: 'number' },
      fullPage: { type: 'boolean' },
      maxChars: { type: 'number' },
      tabId: { type: 'string' }
    },
    required: ['action']
  },
  risk: RISK.MEDIUM,
  permissions: [PERMISSION.BROWSER_AUTOMATE],
  confirmation: CONFIRMATION.NONE,

  policyHints() {
    return { __viaAgent: true };
  },

  async execute(args) {
    const result = await handleWebAgent(args);
    if (!result.success) return `Web agent error: ${result.error}`;
    let msg = `Web agent action '${result.action}' completed.`;
    if (result.newTabs && result.newTabs.length) msg += `\nNew tab(s) opened: ${result.newTabs.join(', ')} — now active.`;
    if (result.observation) msg += `\n${result.observation}`;
    if (result.analysis) msg += `\n[Visual Analysis]: ${result.analysis}`;
    if (result.analysisError) msg += `\n[Vision analysis error]: ${result.analysisError}`;
    if (result.title) msg += `\nPage: "${result.title}" (${result.url})`;
    if (result.dom) msg += `\nCurrent simplified DOM:\n${result.dom}`;
    return msg;
  }
};

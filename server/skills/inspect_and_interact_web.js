/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — INSPECT AND INTERACT WEB (browser agent)
   ========================================================================== */

import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { handleWebAgent } from '../web-agent/engine.js';

export default {
  name: 'inspect_and_interact_web',
  description: 'Drives a real Chrome window on live websites: navigate, getDOM to find element IDs, then click/type/scroll; extract for article text; screenshot to visually analyse. Chain calls until the task is done.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['navigate', 'getDOM', 'extract', 'click', 'type', 'keypress', 'select', 'hover', 'scroll', 'wait', 'screenshot', 'back', 'forward', 'reload', 'openTab', 'closeTab', 'listTabs'] },
      url: { type: 'string' },
      elementId: { type: 'string' },
      text: { type: 'string' },
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
    if (result.analysis) msg += `\n[Visual Analysis]: ${result.analysis}`;
    if (result.analysisError) msg += `\n[Vision analysis error]: ${result.analysisError}`;
    if (result.title) msg += `\nPage: "${result.title}" (${result.url})`;
    if (result.dom) msg += `\nCurrent simplified DOM:\n${result.dom}`;
    return msg;
  }
};

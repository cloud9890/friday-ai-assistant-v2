/* ==========================================================================
   F.R.I.D.A.Y. // SKILL — CONTROL DESKTOP APP (accessibility-first UI agent)
   Computer-use discipline: observe a native app's UI Automation tree, act on
   elements by index, verify the effect from the read-back every action
   returns. Screenshots + vision are the fallback for UIs the tree can't see.
   ========================================================================== */

import { RISK, CONFIRMATION, PERMISSION } from '../security/risk.js';
import { handleDesktopAgent } from '../desktop-agent/engine.js';

export default {
  name: 'control_desktop_app',
  description: [
    'Reads and operates the UI of native Windows apps (the user\'s own desktop). Workflow discipline:',
    '1) listApps to see what is running, then observe the target app to get its element tree;',
    '2) act ONLY on element indices from the latest observation — never guess an index;',
    '3) verify every effect from the verification lines that come back (setValue reads the value back; click reports the new window/focus) and observe again when unsure;',
    '4) prefer setValue for text, click for buttons/links, pressKey only when no element expresses the action, performAction only for patterns the element advertises;',
    '5) use screenshot (with a query) only when the element tree cannot see the UI (games, Electron, canvas);',
    '6) shell windows (cmd/powershell) are blocked for automation. One action at a time; observe -> act -> verify until done.'
  ].join(' '),
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['listApps', 'observe', 'click', 'setValue', 'pressKey', 'focus', 'scroll', 'performAction', 'screenshot'] },
      appName: { type: 'string', description: 'Process name of the target app (e.g. notepad, CalculatorApp).' },
      pid: { type: 'number', description: 'Exact process id — use when several windows share a name.' },
      windowTitle: { type: 'string', description: 'Optional title filter; the window title must contain it.' },
      index: { type: 'number', description: 'Element index from the latest observation of this app.' },
      text: { type: 'string', description: 'For setValue: the text to place in the element.' },
      key: { type: 'string', description: 'For pressKey: Enter, Tab, ctrl+a, alt+F4, shift+Tab...' },
      direction: { type: 'string', enum: ['up', 'down'] },
      actionName: { type: 'string', description: 'For performAction: invoke, toggle, select, expand, collapse, scrollintoview.' },
      query: { type: 'string', description: 'For observe: filter listed elements by name/role/value. For screenshot: what to look for.' },
      maxElements: { type: 'number', description: 'Observation tree cap (10-300, default 120).' }
    },
    required: ['action']
  },
  risk: RISK.MEDIUM,
  permissions: [PERMISSION.UI_AUTOMATE],
  confirmation: CONFIRMATION.NONE,

  async execute(args) {
    const result = await handleDesktopAgent(args);
    if (!result.success) return `Desktop agent error: ${result.error}`;
    let msg = `Desktop agent action '${result.action}' completed.`;
    if (result.analysis) msg += `\n[Visual Analysis]: ${result.analysis}`;
    if (result.analysisError) msg += `\n[Vision analysis error]: ${result.analysisError}`;
    if (result.result) msg += `\n${result.result}`;
    if (result.observation) msg += `\nCurrent element tree:\n${result.observation}`;
    return msg;
  }
};

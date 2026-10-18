/* ==========================================================================
   F.R.I.D.A.Y. // SECURITY — RISK MODEL
   Phase 1 (S3). Risk levels and confirmation modes used by every policy
   decision. Levels are ordered: a higher level never silently downgrades.
   ========================================================================== */

export const RISK = {
  SAFE: 'safe',       // read-only, no side effects
  LOW: 'low',         // reversible, local, no new authority
  MEDIUM: 'medium',   // writes data, reads the filesystem, or touches the network
  HIGH: 'high',       // launches processes, writes user files, runs macros
  BLOCKED: 'blocked'  // never executed, regardless of caller
};

const ORDER = [RISK.SAFE, RISK.LOW, RISK.MEDIUM, RISK.HIGH, RISK.BLOCKED];

export function riskLevel(risk) {
  const i = ORDER.indexOf(risk);
  return i === -1 ? ORDER.length - 1 : i; // unknown risk is treated as the strictest
}

export function atLeast(risk, floor) {
  return riskLevel(risk) >= riskLevel(floor);
}

export const CONFIRMATION = {
  NONE: 'none',       // no user interaction required
  ALWAYS: 'always'    // the user must approve before the action runs
};

export const DECISION = {
  ALLOW: 'allow',
  DENY: 'deny'
};

export function allow(reason = '') {
  return { decision: DECISION.ALLOW, reason };
}

export function deny(reason) {
  return { decision: DECISION.DENY, reason };
}

/**
 * Permission identifiers that policies understand. Declared here (not in
 * permissions.js) so skills can reference them without importing the
 * permission table that is generated from the skills themselves.
 */
export const PERMISSION = {
  READ_SYSTEM: 'read:system',
  READ_FILES: 'read:files',
  WRITE_FILES: 'write:files',
  DELETE_FILES: 'delete:files',
  LAUNCH_PROCESS: 'launch:process',
  CONTROL_MEDIA: 'control:media',
  CONTROL_VOLUME: 'control:volume',
  NETWORK_FETCH: 'network:fetch',
  BROWSER_AUTOMATE: 'browser:automate',
  UI_AUTOMATE: 'ui:automate',
  SCREEN_CAPTURE: 'screen:capture',
  MEMORY_READ: 'memory:read',
  MEMORY_WRITE: 'memory:write',
  SCHEDULE_READ: 'schedule:read',
  SCHEDULE_WRITE: 'schedule:write',
  NOTIFY: 'notify',
  MODEL_INVOKE: 'model:invoke',
  SCRIPT_EXECUTE: 'script:execute'
};

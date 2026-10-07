/* ==========================================================================
   F.R.I.D.A.Y. // SKILLS — REGISTRY
   Single source of truth for every capability Friday exposes. It generates:
     - the model-facing tool catalog (OpenAI function-calling schemas)
     - the kernel capability table (risk / permissions / confirmation / schema)
     - policy hints, confirmation descriptions and execution dispatch
   Adding a capability = adding one file in server/skills/ and listing it in
   index.js. Policy is declared on the skill, so nothing ships ungated.
   ========================================================================== */

import SKILLS from './index.js';

/** @type {Map<string, object>} */
const byName = new Map();

// Fail fast at boot: a malformed skill must stop the server, not limp along.
for (const skill of SKILLS) {
  const required = ['name', 'description', 'parameters', 'risk', 'permissions', 'confirmation', 'execute'];
  for (const field of required) {
    if (skill[field] === undefined) {
      throw new Error(`Skill "${skill?.name || '<unnamed>'}" is missing required field "${field}"`);
    }
  }
  if (byName.has(skill.name)) {
    throw new Error(`Duplicate skill name: ${skill.name}`);
  }
  byName.set(skill.name, skill);
}

/** OpenAI function-calling catalog for the model. */
export function toolCatalog() {
  return SKILLS.map(skill => ({
    type: 'function',
    function: {
      name: skill.name,
      description: skill.description,
      parameters: skill.parameters
    }
  }));
}

/** Kernel capability table: { name: { risk, permissions, confirmation, inputSchema } }. */
export function capabilityTable() {
  const table = {};
  for (const [name, skill] of byName) {
    const inputSchema = {};
    for (const [field, prop] of Object.entries(skill.parameters.properties || {})) {
      inputSchema[field] = prop.type || 'string';
    }
    table[name] = {
      risk: skill.risk,
      permissions: skill.permissions,
      confirmation: skill.confirmation,
      inputSchema
    };
  }
  return table;
}

export function getSkill(name) {
  return byName.get(name) || null;
}

export function skillNames() {
  return SKILLS.map(s => s.name);
}

/** Skill-declared internal policy hints (__targetPath, __readDirs, ...). */
export function policyHints(name, args) {
  const skill = byName.get(name);
  return (skill && typeof skill.policyHints === 'function') ? skill.policyHints(args) : {};
}

/** Human-readable text for confirmation-required actions. */
export function describe(name, args) {
  const skill = byName.get(name);
  if (skill && typeof skill.describe === 'function') return skill.describe(args);
  return `Execute ${name}.`;
}

/** Dispatch to the skill's executor. The kernel has already authorised this call. */
export async function executeSkill(name, args, hints, ctx) {
  const skill = byName.get(name);
  if (!skill) return `Error: unknown skill ${name}.`;
  return skill.execute(args, ctx, hints);
}

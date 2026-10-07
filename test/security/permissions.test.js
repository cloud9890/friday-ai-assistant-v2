/* Phase 1 (R4/R12): every capability has complete, declared metadata. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOOL_SECURITY, PERMISSION, ENDPOINT_TO_TOOL, PUBLIC_ENDPOINTS,
  getToolMetadata, metadataForEndpoint, validateInput
} from '../../server/security/permissions.js';
import { RISK, CONFIRMATION } from '../../server/security/risk.js';

const RISKS = new Set(Object.values(RISK));
const CONFIRMATIONS = new Set(Object.values(CONFIRMATION));
const PERMISSIONS = new Set(Object.values(PERMISSION));

test('every capability declares risk, permissions, confirmation and an input schema', () => {
  const entries = Object.entries(TOOL_SECURITY);
  assert.ok(entries.length >= 14, `expected the full capability table, got ${entries.length}`);
  for (const [name, meta] of entries) {
    assert.ok(RISKS.has(meta.risk), `${name}: invalid risk "${meta.risk}"`);
    assert.ok(CONFIRMATIONS.has(meta.confirmation), `${name}: invalid confirmation "${meta.confirmation}"`);
    assert.ok(Array.isArray(meta.permissions), `${name}: permissions must be an array`);
    for (const p of meta.permissions) {
      assert.ok(PERMISSIONS.has(p), `${name}: unknown permission "${p}"`);
    }
    assert.equal(typeof meta.inputSchema, 'object', `${name}: inputSchema must be an object`);
  }
});

test('irreversible capabilities always require confirmation, never silent execution', () => {
  // Policy (agent era): reversible HIGH-risk actions execute on the user's
  // spoken command; only irreversible destruction confirms first.
  const IRREVERSIBLE = ['delete_path'];
  for (const name of IRREVERSIBLE) {
    const meta = TOOL_SECURITY[name];
    assert.ok(meta, `${name} must exist in the capability table`);
    assert.equal(meta.confirmation, CONFIRMATION.ALWAYS, `${name} is irreversible but not confirmed`);
  }
});

test('no capability is declared with the blocked risk (nothing ships pre-blocked)', () => {
  const blocked = Object.entries(TOOL_SECURITY).filter(([, m]) => m.risk === RISK.BLOCKED);
  assert.deepEqual(blocked.map(b => b[0]), []);
});

test('every guarded endpoint maps to a real capability', () => {
  const mapped = Object.entries(ENDPOINT_TO_TOOL);
  assert.ok(mapped.length >= 11);
  for (const [endpoint, tool] of mapped) {
    assert.ok(endpoint.startsWith('/api/'), `${endpoint} is not an API path`);
    assert.ok(TOOL_SECURITY[tool], `${endpoint} maps to unknown capability ${tool}`);
    assert.ok(metadataForEndpoint(endpoint), `${endpoint} has no metadata`);
  }
});

test('public endpoints never overlap guarded endpoints', () => {
  for (const p of PUBLIC_ENDPOINTS) {
    assert.ok(!ENDPOINT_TO_TOOL[p], `${p} cannot be both public and guarded`);
  }
});

test('unknown capabilities resolve to null so the kernel can fail closed', () => {
  assert.equal(getToolMetadata('rm -rf /'), null);
  assert.equal(metadataForEndpoint('/api/not-a-route'), null);
});

test('validateInput keeps declared fields and drops everything else', () => {
  const schema = { appName: 'string' };
  const res = validateInput(schema, { appName: 'notepad', evil: 'rm -rf /', __proto__polluted: 1 });
  assert.equal(res.ok, true);
  assert.deepEqual(res.clean, { appName: 'notepad' });
  assert.equal('evil' in res.clean, false);
});

test('validateInput rejects wrong types (so the model cannot smuggle objects)', () => {
  assert.equal(validateInput({ appName: 'string' }, { appName: { evil: true } }).ok, false);
  assert.equal(validateInput({ amount: 'number' }, { amount: '50' }).ok, false);
  assert.equal(validateInput({ steps: 'array' }, { steps: 'open calc' }).ok, false);
  assert.equal(validateInput({ amount: 'number' }, { amount: 50 }).ok, true);
});

test('validateInput tolerates missing optional fields and junk args', () => {
  assert.deepEqual(validateInput({ query: 'string' }, {}).clean, {});
  assert.deepEqual(validateInput({ query: 'string' }, null).clean, {});
  assert.deepEqual(validateInput({ query: 'string' }, 'a string').clean, {});
  assert.deepEqual(validateInput({ query: 'string' }, [1, 2, 3]).clean, {});
  assert.deepEqual(validateInput(null, { anything: 1 }).clean, {});
});

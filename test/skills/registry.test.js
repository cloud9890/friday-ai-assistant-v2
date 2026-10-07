/* Skill registry: the generated capability table must be complete and valid. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toolCatalog, capabilityTable, getSkill, skillNames, policyHints, describe
} from '../../server/skills/registry.js';
import { RISK, CONFIRMATION } from '../../server/security/risk.js';

test('the catalog and capability table cover the same skill set', () => {
  const catalog = toolCatalog().map(t => t.function.name);
  const table = Object.keys(capabilityTable());
  assert.equal(catalog.length, skillNames().length);
  assert.deepEqual(catalog.slice().sort(), table.slice().sort());
});

test('every generated tool schema is a valid OpenAI function definition', () => {
  for (const tool of toolCatalog()) {
    assert.equal(tool.type, 'function');
    assert.equal(tool.function.parameters.type, 'object');
    assert.ok(tool.function.description.length > 10, `${tool.function.name}: needs a description`);
  }
});

test('deletion stays confirmation-gated and shell execution stays blocked', () => {
  const table = capabilityTable();
  assert.equal(table.delete_path.confirmation, CONFIRMATION.ALWAYS);
  assert.equal(table.delete_path.permissions.includes('delete:files'), true);
  assert.ok(!table.arbitrary_shell_command, 'unknown capabilities must not exist');
});

test('registry resolves policy hints and descriptions per skill', () => {
  const hints = policyHints('create_folder', { name: 'demo', parent: 'desktop' });
  assert.ok(hints.__targetPath.endsWith('demo'));
  assert.deepEqual(policyHints('fetch_system_status', {}), {});
  assert.match(describe('delete_path', { name: 'x', parent: 'desktop' }), /Permanently delete "x"/);
});

test('unknown skills resolve to null so the kernel can fail closed', () => {
  assert.equal(getSkill('rm -rf /'), null);
  assert.deepEqual(policyHints('rm -rf /', {}), {});
});

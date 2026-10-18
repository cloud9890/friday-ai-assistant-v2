/* Desktop agent authorization: kernel gating + registry wiring. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorize } from '../../server/security/kernel.js';
import { toolCatalog } from '../../server/skills/registry.js';
import { SENSITIVE_PROCESS_NAMES, validateProcessTarget } from '../../server/security/app-policy.js';

test('control_desktop_app is registered with a valid OpenAI schema and medium risk', () => {
  const tool = toolCatalog().find((t) => t.function.name === 'control_desktop_app');
  assert.ok(tool, 'skill must be in the tool catalog');
  assert.equal(tool.function.parameters.type, 'object');
  assert.ok(tool.function.description.length > 100, 'description must teach the workflow');
  const actions = tool.function.parameters.properties.action.enum;
  for (const expected of ['listApps', 'observe', 'click', 'setValue', 'pressKey', 'focus', 'scroll', 'performAction', 'screenshot']) {
    assert.ok(actions.includes(expected), `action ${expected} must be in the enum`);
  }
});

test('kernel allows a clean observe/click on a normal process name', () => {
  const observe = authorize({ tool: 'control_desktop_app', actor: 'agent', args: { action: 'observe', appName: 'notepad' } });
  assert.equal(observe.decision, 'allow');

  const click = authorize({ tool: 'control_desktop_app', actor: 'agent', args: { action: 'click', appName: 'notepad', index: 4 } });
  assert.equal(click.decision, 'allow');

  const byPid = authorize({ tool: 'control_desktop_app', actor: 'agent', args: { action: 'observe', pid: 1234 } });
  assert.equal(byPid.decision, 'allow');
});

test('kernel refuses injection-style and path-style app targets', () => {
  for (const bad of [
    '../../etc', 'foo;bar', 'foo|bar', 'foo&bar', '$(calc)', 'C:\\Windows\\notepad.exe',
    'a'.repeat(80), '`calc`', "'quoted'"
  ]) {
    const decision = authorize({ tool: 'control_desktop_app', actor: 'agent', args: { action: 'observe', appName: bad } });
    assert.equal(decision.decision, 'deny', `appName "${bad}" must be denied`);
  }
});

test('kernel refuses shell-process targets outright', () => {
  for (const shell of ['cmd', 'powershell', 'pwsh', 'wscript', 'cscript', 'mshta']) {
    const decision = authorize({ tool: 'control_desktop_app', actor: 'agent', args: { action: 'observe', appName: shell } });
    assert.equal(decision.decision, 'deny', `${shell} windows must never be automatable`);
  }
  assert.equal(validateProcessTarget('cmd').ok, false);
});

test('schema validation drops unknown keys but keeps the action', () => {
  const decision = authorize({
    tool: 'control_desktop_app', actor: 'agent',
    args: { action: 'observe', appName: 'notepad', __proto_pollution: 'x', steps: [] }
  });
  assert.equal(decision.decision, 'allow');
});

test('every sensitive process name is caught by the static validator', () => {
  for (const name of SENSITIVE_PROCESS_NAMES) {
    assert.equal(validateProcessTarget(name).ok, false, `${name} must be refused`);
  }
  assert.equal(validateProcessTarget('notepad').ok, true);
  assert.equal(validateProcessTarget('').ok, false);
  assert.equal(validateProcessTarget(null).ok, false);
});

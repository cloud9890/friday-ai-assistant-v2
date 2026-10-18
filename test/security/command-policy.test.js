/* Command policy: which commands may run, which must be approved, which are
   refused outright. The runner is argv-only (no shell), so composition
   operators can never be interpreted — but their presence must still never be
   auto-approved, and destructive verbs/patterns must never run at all. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { classifyCommand, COMMAND_DECISION } from '../../server/security/command-policy.js';
import { authorize } from '../../server/security/kernel.js';
import { capabilityTable } from '../../server/skills/registry.js';
import { homeDir } from '../../server/lib/paths.js';

const D = COMMAND_DECISION;

test('read-only verbs are allowed without a prompt', () => {
  const allowed = [
    { command: 'git', args: ['status'] },
    { command: 'git', args: ['status', '--short'] },
    { command: 'git', args: ['log', '--oneline', '-n', '5'] },
    { command: 'git', args: ['diff', '--stat'] },
    { command: 'git', args: ['branch'] },
    { command: 'git', args: ['branch', '-a'] },
    { command: 'npm', args: ['ls'] },
    { command: 'npm', args: ['outdated'] },
    { command: 'node', args: ['-v'] },
    { command: 'node', args: ['--version'] },
    { command: 'ipconfig' },
    { command: 'tasklist' },
    { command: 'ipconfig', args: ['/all'] }
  ];
  for (const request of allowed) {
    assert.equal(classifyCommand(request).decision, D.ALLOW, `${request.command} ${(request.args || []).join(' ')} must be allowed`);
  }
});

test('a read-only verb with mutating arguments asks first', () => {
  for (const request of [
    { command: 'git', args: ['push', 'origin', 'main'] },
    { command: 'git', args: ['commit', '-m', 'x'] },
    { command: 'git', args: ['branch', '-D', 'feature'] },
    { command: 'git', args: ['checkout', 'main'] },
    { command: 'npm', args: ['install'] },
    { command: 'npm', args: ['run', 'build'] },
    { command: 'node', args: ['-e', 'process.exit()'] },
    { command: 'python', args: ['script.py'] },
    { command: 'unknown-thing' }
  ]) {
    assert.equal(classifyCommand(request).decision, D.CONFIRM, `${request.command} ${(request.args || []).join(' ')} must ask`);
  }
});

test('destructive verbs and system-level tools are denied outright', () => {
  for (const request of [
    { command: 'format', args: ['C:'] },
    { command: 'diskpart' },
    { command: 'cmd', args: ['/c', 'dir'] },
    { command: 'cmd.exe', args: ['/c', 'dir'] },
    { command: 'powershell', args: ['-Command', 'Remove-Item -Recurse C:\\'] },
    { command: 'pwsh' },
    { command: 'bash' },
    { command: 'wsl', args: ['rm', '-rf', '/'] },
    { command: 'reg', args: ['delete', 'HKLM\\Software\\X', '/f'] },
    { command: 'schtasks', args: ['/create'] },
    { command: 'net', args: ['user', 'hacker', '/add'] },
    { command: 'sc', args: ['delete', 'wuauserv'] },
    { command: 'shutdown', args: ['/s'] },
    { command: 'curl', args: ['http://example.com'] },
    { command: 'certutil', args: ['-urlcache', '-f', 'http://example.com/x'] }
  ]) {
    const verdict = classifyCommand(request);
    assert.equal(verdict.decision, D.DENY, `${request.command} must be denied`);
    assert.ok(verdict.reason.length > 0, 'a denial must explain itself');
  }
});

test('destructive argument patterns are denied wherever they appear', () => {
  for (const request of [
    { command: 'rmdir', args: ['/s', '/q', 'C:\\Users'] },
    { command: 'rd', args: ['/s', 'C:\\x'] },
    { command: 'del', args: ['/f', '/s', 'C:\\x\\*'] },
    { command: 'rm', args: ['-rf', '/'] },
    { command: 'rm', args: ['-r', 'folder'] },
    { command: 'whatever', args: ['Remove-Item', '-Recurse', 'C:\\x'] },
    { command: 'git', args: ['log', '--pretty=%H;', 'rm', '-rf', '/'] },
    { command: 'git', args: ['log', '&&', 'shutdown', '/s'] },
    { command: 'x', args: [':(){ :|:& };:'] },
    { command: 'x', args: ['> C:\\Windows\\System32\\drivers\\etc\\hosts'] }
  ]) {
    assert.equal(classifyCommand(request).decision, D.DENY, `${request.command} ${request.args.join(' ')} must be denied`);
  }
});

test('shell composition operators are never auto-approved', () => {
  for (const args of [
    ['log', ';', 'whoami'],
    ['log', '&&', 'ipconfig'],
    ['log', '|', 'findstr', 'x'],
    ['log', '`whoami`'],
    ['log', '$(whoami)']
  ]) {
    const verdict = classifyCommand({ command: 'git', args });
    assert.notEqual(verdict.decision, D.ALLOW, `git ${args.join(' ')} must not be auto-approved`);
  }
  const joined = classifyCommand({ command: 'git', args: ['log', ';', 'del', '*'] });
  assert.equal(joined.decision, D.CONFIRM, 'composition makes the user approve it, it is not silently dropped');
});

test('shell builtins are refused as programs (they would need a shell)', () => {
  for (const request of [{ command: 'dir' }, { command: 'del', args: ['*'] }, { command: 'type', args: ['x.txt'] }]) {
    const verdict = classifyCommand(request);
    assert.equal(verdict.decision, D.CONFIRM, `${request.command} asks first`);
    assert.match(verdict.reason, /shell builtin|shell operators/);
  }
});

test('malformed requests are denied, never guessed at', () => {
  assert.equal(classifyCommand({}).decision, D.DENY);
  assert.equal(classifyCommand({ command: '   ' }).decision, D.DENY);
  assert.equal(classifyCommand({ command: 'C:\\Windows\\System32\\ipconfig.exe' }).decision, D.DENY, 'a path is not a bare program name');
  assert.equal(classifyCommand({ command: 'git', args: 'status' }).decision, D.DENY, 'args must be an array');
  assert.equal(classifyCommand({ command: 'git', args: [1, 2] }).decision, D.DENY, 'every argument must be a string');
  assert.equal(classifyCommand({ command: 'git', args: ['a\nb'] }).decision, D.DENY, 'a line break cannot be an argument');
  assert.equal(classifyCommand({ command: 'git', args: ['a\0b'] }).decision, D.DENY, 'a NUL byte cannot be an argument');
  assert.equal(classifyCommand({ command: 'git', args: Array(40).fill('x') }).decision, D.DENY, 'arg count is bounded');
  assert.equal(classifyCommand({ command: 'git', args: ['x'.repeat(600)] }).decision, D.DENY, 'arg length is bounded');
  assert.equal(classifyCommand({ command: 'git;dir' }).decision, D.DENY, 'the verb itself cannot carry operators');
});

test('run_command is registered with the exec permission and fails closed on confirmation', () => {
  const table = capabilityTable();
  assert.ok(table.run_command, 'run_command must be registered');
  assert.ok(table.run_command.permissions.includes('exec:command'), 'run_command must declare exec:command');
  assert.equal(table.run_command.confirmation, 'always', 'the default must be "ask", not "run"');
});

test('the kernel downgrades read-only commands and refuses the rest', () => {
  const readOnly = authorize({ tool: 'run_command', args: { command: 'git', args: ['status'] } });
  assert.equal(readOnly.decision, 'allow');
  assert.equal(readOnly.confirmation, 'none', 'a read-only command runs without a prompt');

  const needsApproval = authorize({ tool: 'run_command', args: { command: 'npm', args: ['install'] } });
  assert.equal(needsApproval.decision, 'allow');
  assert.equal(needsApproval.confirmation, 'always', 'a state-changing command still asks');

  for (const args of [
    { command: 'format', args: ['C:'] },
    { command: 'powershell', args: ['-Command', 'x'] },
    { command: 'rm', args: ['-rf', '/'] },
    { command: 'git', args: ['log', '&&', 'shutdown', '/s'] },
    { command: '' }
  ]) {
    const denied = authorize({ tool: 'run_command', args });
    assert.equal(denied.decision, 'deny', `run_command ${JSON.stringify(args)} must be denied`);
  }
});

test('the working directory cannot escape the read roots', () => {
  const inside = authorize({ tool: 'run_command', args: { command: 'git', args: ['status'], cwd: homeDir } });
  assert.equal(inside.decision, 'allow');

  for (const cwd of [path.join(homeDir, '..', 'Windows'), path.join(homeDir, '.ssh'), path.join(homeDir, 'AppData')]) {
    const outside = authorize({ tool: 'run_command', args: { command: 'git', args: ['status'], cwd } });
    assert.equal(outside.decision, 'deny', `cwd ${cwd} must be refused`);
  }
});

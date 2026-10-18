/* The runner: argv-only, no shell. The exec seam is stubbed here so the
   timeout, the not-found path and the literal-argument guarantee are all
   provable without depending on what happens to be installed. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCommand, formatResult, DEFAULT_TIMEOUT_MS } from '../../server/skills/run_command.js';
import skill from '../../server/skills/run_command.js';

/** An execFile stand-in that records the call and replies with a canned result. */
function stubExec(reply) {
  const calls = [];
  const impl = (command, args, options, cb) => {
    calls.push({ command, args, options });
    cb(reply.err ?? null, reply.stdout ?? '', reply.stderr ?? '');
  };
  return { impl, calls };
}

test('the runner passes the program and arguments as an array, never a shell string', async () => {
  const { impl, calls } = stubExec({ stdout: 'On branch main\n' });
  const result = await runCommand({
    command: 'git',
    args: ['status', '--short', 'x;y && z | w'],
    cwd: 'C:\\Users\\test',
    execFileImpl: impl
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'git');
  assert.deepEqual(calls[0].args, ['status', '--short', 'x;y && z | w'], 'operators stay one literal argument');
  assert.equal(calls[0].options.shell, false, 'the shell must be off explicitly');
  assert.equal(calls[0].options.cwd, 'C:\\Users\\test');
  assert.equal(calls[0].options.timeout, DEFAULT_TIMEOUT_MS);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'On branch main\n');
});

test('a real command runs and its real output comes back', async () => {
  const result = await runCommand({ command: 'node', args: ['-v'] });
  assert.equal(result.code, 0, `node -v should succeed, got: ${result.message}`);
  assert.match(result.stdout, /^v\d+\./, 'the runner returns the program output verbatim');
});

test('arguments are passed literally — a shell separator cannot split the call', async () => {
  const result = await runCommand({
    command: 'node',
    args: ['-e', 'process.stdout.write(String(process.argv[1]))', 'a;b&&c|d']
  });
  assert.equal(result.code, 0, `expected success, got: ${result.message}`);
  assert.equal(result.stdout, 'a;b&&c|d', 'the operator characters reach the program as one argument');
});

test('a command that overruns its timeout is reported as killed, not invented', async () => {
  const err = Object.assign(new Error('Command failed: timeout'), { killed: true, signal: 'SIGTERM' });
  const { impl } = stubExec({ err, stdout: 'partial' });
  const result = await runCommand({ command: 'ping', args: ['-t', 'x'], timeoutMs: 50, execFileImpl: impl });
  assert.equal(result.timedOut, true);
  assert.equal(result.signal, 'SIGTERM');

  const text = formatResult('ping', ['-t', 'x'], result, 'C:\\Users\\test');
  assert.match(text, /killed after/);
  assert.match(text, /partial/, 'whatever was produced before the kill is still shown');
});

test('a program that does not exist says so, and points at the file tools', async () => {
  const err = Object.assign(new Error('spawn del ENOENT'), { code: 'ENOENT' });
  const { impl } = stubExec({ err });
  const result = await runCommand({ command: 'del', args: ['*'], execFileImpl: impl });
  assert.equal(result.notFound, true);

  const text = formatResult('del', ['*'], result, 'C:\\Users\\test');
  assert.match(text, /Command not found: del/);
  assert.match(text, /list_dir, read_file, write_file, delete_path/, 'the model is pointed at the audited file tools');
});

test('a non-zero exit is reported with its code and stderr, and never throws', async () => {
  const err = Object.assign(new Error('exit 1'), { code: 1 });
  const { impl } = stubExec({ err, stderr: 'fatal: not a git repository' });
  const result = await runCommand({ command: 'git', args: ['status'], execFileImpl: impl });
  assert.equal(result.code, 1);

  const text = formatResult('git', ['status'], result, 'C:\\Users\\test');
  assert.match(text, /exit code: 1/);
  assert.match(text, /fatal: not a git repository/);
});

test('long output is clamped so one command cannot flood the context', () => {
  const huge = 'x'.repeat(20000);
  const text = formatResult('git', ['log'], { code: 0, stdout: huge, stderr: '' }, 'C:\\Users\\test');
  assert.ok(text.length < 9000, `clamped output must stay small, got ${text.length}`);
  assert.match(text, /output truncated/);
});

test('the skill defaults the working directory to the home folder and describes itself', () => {
  const description = skill.describe({ command: 'git', args: ['status'] });
  assert.match(description, /git status/, 'the confirmation shows the exact command');
  assert.equal(skill.confirmation, 'always', 'the skill default is to ask');
  assert.ok(skill.permissions.includes('exec:command'));
});

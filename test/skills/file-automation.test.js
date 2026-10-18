/* Phase C tail, end to end: organize_files, zip_folder and convert_image each
   go through the SAME kernel the agent uses — policyHints plans the work,
   authorize() certifies it, executeSkill() obeys. Real files, real bsdtar, real
   System.Drawing, in scratch folders under Documents that are removed after. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { documentsDir } from '../../server/lib/paths.js';
import { authorize } from '../../server/security/kernel.js';
import { policyHints, executeSkill } from '../../server/skills/registry.js';
import { zipFolder } from '../../server/skills/zip_folder.js';
import { convertImage } from '../../server/skills/convert_image.js';

// Kept directly under Documents so the kernel's write-root policy accepts them.
fs.mkdirSync(documentsDir, { recursive: true });
const scratch = fs.mkdtempSync(path.join(documentsDir, '.friday-fileauto-'));
const scratchName = path.basename(scratch);
const pngPath = path.join(documentsDir, '.friday-img-1x1.png');
const ONE_PX_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
fs.writeFileSync(pngPath, Buffer.from(ONE_PX_PNG, 'base64'));

/** Drives one skill exactly the way the agent loop does. */
async function run(name, args) {
  const hints = policyHints(name, args);
  const decision = authorize({ tool: name, args, actor: 'agent', ...hints });
  if (decision.decision !== 'allow') return { denied: decision.reason, decision };
  const reply = await executeSkill(name, args, hints, {});
  return { reply, decision };
}

after(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.rmSync(`${scratch}.zip`, { force: true });
  fs.rmSync(pngPath, { force: true });
  fs.rmSync(path.join(documentsDir, '.friday-img-1x1.jpg'), { force: true });
});

test('organize_files moves loose files into category folders and leaves the rest', async () => {
  fs.writeFileSync(path.join(scratch, 'photo.png'), 'png');
  fs.writeFileSync(path.join(scratch, 'notes.txt'), 'txt');
  fs.writeFileSync(path.join(scratch, 'song.mp3'), 'mp3');
  fs.writeFileSync(path.join(scratch, 'mystery.xyz'), 'xyz');
  fs.writeFileSync(path.join(scratch, '.hidden'), 'hidden');
  fs.mkdirSync(path.join(scratch, 'keepme'));

  const { reply, decision } = await run('organize_files', { parent: 'documents', folder: scratchName });

  assert.equal(decision.confirmation, 'always', 'a bulk move always asks first');
  assert.match(reply, /Organized 4 files/);
  assert.match(reply, /Images/);

  assert.ok(fs.existsSync(path.join(scratch, 'Images', 'photo.png')));
  assert.ok(fs.existsSync(path.join(scratch, 'Documents', 'notes.txt')));
  assert.ok(fs.existsSync(path.join(scratch, 'Audio', 'song.mp3')));
  assert.ok(fs.existsSync(path.join(scratch, 'Other', 'mystery.xyz')));
  // Untouched: an existing subfolder and a dotfile.
  assert.ok(fs.existsSync(path.join(scratch, 'keepme')));
  assert.ok(fs.existsSync(path.join(scratch, '.hidden')));
  // The loose originals are gone.
  assert.equal(fs.existsSync(path.join(scratch, 'photo.png')), false);
});

test('organize_files is honest when a folder has no loose files', async () => {
  const empty = path.join(documentsDir, '.friday-empty-');
  fs.mkdirSync(empty, { recursive: true });
  try {
    const hints = policyHints('organize_files', { parent: 'documents', folder: '.friday-empty-' });
    assert.deepEqual(hints.__moves, []);
    const decision = authorize({ tool: 'organize_files', args: { parent: 'documents' }, actor: 'agent', ...hints });
    assert.equal(decision.decision, 'deny');
    assert.match(decision.reason, /nothing to move/);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('organize_files refuses a folder name that tries to escape', async () => {
  const hints = policyHints('organize_files', { parent: 'documents', folder: '..\\..\\Windows' });
  assert.equal(hints.__moves, undefined, 'the planner must yield no plan for an unsafe name');
});

test('zip_folder creates a real archive beside the folder', async () => {
  const { reply } = await run('zip_folder', { name: scratchName, parent: 'documents' });
  assert.match(reply, /Created/);

  const zipPath = `${scratch}.zip`;
  assert.ok(fs.existsSync(zipPath), `expected ${zipPath}`);
  const head = fs.readFileSync(zipPath).subarray(0, 2).toString('latin1');
  assert.equal(head, 'PK', 'a real zip starts with the PK signature');
});

test('convert_image writes a real jpg with System.Drawing', async () => {
  const { reply } = await run('convert_image', { name: '.friday-img-1x1.png', parent: 'documents', format: 'jpg' });
  assert.match(reply, /Converted/);

  const jpg = path.join(documentsDir, '.friday-img-1x1.jpg');
  assert.ok(fs.existsSync(jpg), `expected ${jpg}`);
  const bytes = fs.readFileSync(jpg);
  assert.equal(bytes[0], 0xff);
  assert.equal(bytes[1], 0xd8, 'a real jpeg starts with FF D8');
});

test('the archiver and the converter hand file names to the program as arguments, never a shell string', async () => {
  const zipCalls = [];
  await zipFolder({
    source: 'C:\\Users\\t\\.ssh; rm -rf', zipPath: 'C:\\Users\\t\\out.zip',
    execFileImpl: (cmd, args, options, cb) => { zipCalls.push({ cmd, args, options }); cb(null, '', ''); }
  });
  assert.equal(zipCalls[0].cmd, 'tar');
  assert.deepEqual(
    zipCalls[0].args,
    ['-a', '-c', '-f', 'C:\\Users\\t\\out.zip', '-C', 'C:\\Users\\t\\.ssh; rm -rf', '.'],
    'the folder name is one literal argument'
  );
  assert.equal(zipCalls[0].options.shell, false);

  const convCalls = [];
  await convertImage({
    source: 'C:\\a;b.png', dest: 'C:\\a;b.jpg', format: 'jpg',
    execFileImpl: (cmd, args, options, cb) => { convCalls.push({ cmd, args, options }); cb(null, 'ok', ''); }
  });
  assert.equal(convCalls[0].cmd, 'powershell.exe');
  assert.deepEqual(convCalls[0].args.slice(-6), ['-Source', 'C:\\a;b.png', '-Dest', 'C:\\a;b.jpg', '-Format', 'jpg']);
  assert.equal(convCalls[0].options.shell, false);
});

test('the converter rejects an unsupported format and a non-Windows host without spawning anything', async () => {
  let spawned = false;
  const unsupported = await convertImage({
    source: 'a.png', dest: 'a.gif', format: 'gif',
    execFileImpl: () => { spawned = true; }
  });
  assert.equal(unsupported.ok, false);
  assert.match(unsupported.message, /unsupported format/);

  const other = await convertImage({
    source: 'a.png', dest: 'a.jpg', format: 'jpg', platform: 'linux',
    execFileImpl: () => { spawned = true; }
  });
  assert.equal(other.unsupportedPlatform, true);
  assert.equal(spawned, false, 'nothing is spawned for an unsupported request');
});

test('an unsafe target never yields a certified path', () => {
  assert.deepEqual(policyHints('zip_folder', { name: '../evil', parent: 'documents' }), {});
  assert.deepEqual(policyHints('convert_image', { name: 'a.png', parent: 'documents', format: 'gif' }), {});
  assert.deepEqual(policyHints('convert_image', { name: 'a.png', parent: 'nowhere', format: 'png' }), {});
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sync = require('../lib/sync');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lcars-test-'));
const CORE1 = { name: 'lcars-mainframe', version: '1.0.0' };
const CORE2 = { name: 'lcars-mainframe', version: '2.0.0' };

function tree(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));

/** Hash of every file in a dir except the lock, for comparing two vaults byte for byte. */
function snapshot(dir) {
  return Object.fromEntries(sync.walk(dir).filter(f => f !== '.lcars/lock').map(f => [f, sync.sha256(fs.readFileSync(path.join(dir, f)))]));
}

function run(vault, payloadDir, core) {
  const record = sync.readRecord(vault);
  const actions = sync.plan({ payloadDir, vault, record });
  const wrote = sync.apply({ vault, payloadDir, record, actions, core });
  return { actions, wrote, kinds: Object.fromEntries(actions.map(a => [a.path, a.kind])) };
}

const lines = n => Array.from({ length: n }, (_, i) => 'line ' + (i + 1)).join('\n') + '\n';

const V1 = {
  'AGENTS.md': lines(12),
  'conflict.md': 'title\nshared line\nend\n',
  'gone.md': 'core will drop me\n',
  'gone-edited.md': 'core will drop me too\n',
  'deleted.md': 'the owner deletes me\n',
  'Machine/Workflows/x/FINDINGS.md': 'empty findings\n',
  '.obsidian/app.json': '{"a":1}',
};
const V2 = {
  'AGENTS.md': lines(12).replace('line 2\n', 'line 2 (core v2)\n'),
  'conflict.md': 'title\nshared line, core wording\nend\n',
  'deleted.md': 'the owner deletes me, core v2\n',
  'Machine/Workflows/x/FINDINGS.md': 'empty findings v2\n',
  '.obsidian/app.json': '{"a":2}',
  'new.md': 'added in v2\n',
};

function ownerEdits(vault) {
  fs.writeFileSync(path.join(vault, 'AGENTS.md'), lines(12).replace('line 11\n', 'line 11 (owner)\n'));
  fs.writeFileSync(path.join(vault, 'conflict.md'), 'title\nshared line, owner wording\nend\n');
  fs.writeFileSync(path.join(vault, 'gone-edited.md'), 'owner kept editing me\n');
  fs.rmSync(path.join(vault, 'deleted.md'));
  fs.writeFileSync(path.join(vault, 'Machine/Workflows/x/FINDINGS.md'), 'owner run log\n');
  fs.writeFileSync(path.join(vault, '.obsidian/app.json'), '{"a":"owner"}');
  tree(vault, { 'notes/mine.md': 'my note\n', 'local/connectors/x/connector.json': '{}' });
}

test('fresh install creates every file, and a second run writes nothing', () => {
  const p1 = tree(tmp(), V1), vault = tmp();
  const first = run(vault, p1, CORE1);
  assert.ok(first.wrote);
  assert.ok(Object.values(first.kinds).every(k => k === 'create'));
  for (const [rel, text] of Object.entries(V1)) assert.equal(read(vault, rel), text);
  const recordBytes = read(vault, sync.RECORD);
  const second = run(vault, p1, CORE1);
  assert.equal(second.wrote, false);
  assert.ok(Object.values(second.kinds).every(k => k === 'noop'));
  assert.equal(read(vault, sync.RECORD), recordBytes);
});

test('upgrade merges clean edits, never clobbers owner files, and is idempotent', () => {
  const p1 = tree(tmp(), V1), p2 = tree(tmp(), V2), vault = tmp();
  run(vault, p1, CORE1);
  ownerEdits(vault);
  const owner = snapshot(vault);
  const up = run(vault, p2, CORE2);

  assert.equal(up.kinds['AGENTS.md'], 'merge');
  assert.match(read(vault, 'AGENTS.md'), /line 2 \(core v2\)/);
  assert.match(read(vault, 'AGENTS.md'), /line 11 \(owner\)/);

  assert.equal(up.kinds['conflict.md'], 'conflict');
  assert.equal(read(vault, 'conflict.md'), 'title\nshared line, owner wording\nend\n');
  assert.equal(read(vault, 'conflict.md.new'), V2['conflict.md']);

  assert.equal(up.kinds['gone.md'], 'delete');
  assert.equal(exists(vault, 'gone.md'), false);
  assert.equal(up.kinds['gone-edited.md'], 'orphan');
  assert.equal(read(vault, 'gone-edited.md'), 'owner kept editing me\n');
  assert.equal(up.kinds['deleted.md'], 'keep-deleted');
  assert.equal(exists(vault, 'deleted.md'), false);
  assert.equal(up.kinds['new.md'], 'create');

  for (const rel of ['notes/mine.md', 'local/connectors/x/connector.json', 'Machine/Workflows/x/FINDINGS.md', '.obsidian/app.json', 'conflict.md', 'gone-edited.md']) {
    assert.equal(snapshot(vault)[rel], owner[rel], rel + ' must be byte-identical');
  }
  assert.equal(sync.readRecord(vault).core.version, '2.0.0');

  const before = snapshot(vault);
  const again = run(vault, p2, CORE2);
  assert.equal(again.wrote, false, 'second upgrade writes nothing');
  assert.deepEqual(snapshot(vault), before);
});

test('a crash after the files but before the record converges on the same vault', () => {
  const p1 = tree(tmp(), V1), p2 = tree(tmp(), V2);
  const clean = tmp(), crashed = tmp();
  for (const v of [clean, crashed]) { run(v, p1, CORE1); ownerEdits(v); }
  run(clean, p2, CORE2);

  // Crash: the vault files are written, the record and base blobs are not.
  const actions = sync.plan({ payloadDir: p2, vault: crashed, record: sync.readRecord(crashed) });
  for (const a of actions) {
    const file = path.join(crashed, a.path);
    if (a.kind === 'delete') fs.rmSync(file);
    else if (a.kind === 'conflict') fs.writeFileSync(file + '.new', a.text);
    else if (a.text) fs.writeFileSync(file, a.text);
  }
  run(crashed, p2, CORE2);
  assert.deepEqual(snapshot(crashed), snapshot(clean));
});

test('init into an existing folder keeps the owner\'s differing copy and later merges into it', () => {
  const p1 = tree(tmp(), V1), p2 = tree(tmp(), V2);
  const vault = tree(tmp(), { 'AGENTS.md': lines(12).replace('line 11\n', 'line 11 (owner)\n'), 'deleted.md': V1['deleted.md'] });
  const init = run(vault, p1, CORE1);
  assert.equal(init.kinds['AGENTS.md'], 'keep');
  assert.equal(init.kinds['deleted.md'], 'record');
  assert.match(read(vault, 'AGENTS.md'), /line 11 \(owner\)/);
  const up = run(vault, p2, CORE2);
  assert.equal(up.kinds['AGENTS.md'], 'merge');
  assert.match(read(vault, 'AGENTS.md'), /line 2 \(core v2\)[\s\S]*line 11 \(owner\)/);
  assert.equal(up.kinds['deleted.md'], 'replace');
});

test('a missing or corrupted base never loses an owner edit', () => {
  const p1 = tree(tmp(), V1), p2 = tree(tmp(), V2), vault = tmp();
  run(vault, p1, CORE1);
  ownerEdits(vault);
  const blobs = path.join(vault, '.lcars/base');
  for (const name of fs.readdirSync(blobs)) fs.writeFileSync(path.join(blobs, name), 'garbage');
  const up = run(vault, p2, CORE2);
  assert.equal(up.kinds['AGENTS.md'], 'conflict');
  assert.match(read(vault, 'AGENTS.md'), /line 11 \(owner\)/);
  assert.equal(read(vault, 'AGENTS.md.new'), V2['AGENTS.md']);
});

test('without git, an edit that needs merging becomes a conflict', () => {
  const PATH = process.env.PATH;
  process.env.PATH = '';
  try {
    const result = sync.merge3(Buffer.from('a\nb\nc\nd\ne\n'), Buffer.from('a\nb\nc\nd\nE\n'), Buffer.from('A\nb\nc\nd\ne\n'));
    assert.equal(result.clean, false);
    assert.match(result.reason, /git is not installed/);
  } finally { process.env.PATH = PATH; }
});

test('a lock held by a live process blocks a second run; a stale one is cleared', () => {
  const p1 = tree(tmp(), V1), vault = tmp();
  tree(vault, { '.lcars/lock': JSON.stringify({ pid: process.pid, host: os.hostname() }) });
  assert.throws(() => run(vault, p1, CORE1), /holds .lcars\/lock/);
  tree(vault, { '.lcars/lock': JSON.stringify({ pid: 999999, host: os.hostname() }) });
  assert.ok(run(vault, p1, CORE1).wrote);
  assert.equal(exists(vault, '.lcars/lock'), false);
});

test('classify: Obsidian config, FINDINGS and .gitignore are seeds', () => {
  assert.equal(sync.classify('.obsidian/app.json'), 'seed');
  assert.equal(sync.classify('Machine/Workflows/today/FINDINGS.md'), 'seed');
  assert.equal(sync.classify('.gitignore'), 'seed');
  assert.equal(sync.classify('Machine/Workflows/today/SKILL.md'), 'system');
  assert.equal(sync.classify('00 Human/80 Templates/Daily.md'), 'system');
});

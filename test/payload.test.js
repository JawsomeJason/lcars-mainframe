'use strict';
// Guards on what ships in vault/ and connectors/: generic, no code in the vault, overrides documented.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { walk } = require('../lib/sync');
const { discover } = require('../lib/collect');

const ROOT = path.join(__dirname, '..');
const VAULT = path.join(ROOT, 'vault');
const files = walk(VAULT);
const ours = files.filter(f => !f.startsWith('.obsidian/plugins/') && !f.startsWith('.obsidian/themes/'));

// Generic leak patterns, plus the owner's own identifiers (one regex per line) from the gitignored test/leak-patterns.local.
const LOCAL = path.join(__dirname, 'leak-patterns.local');
const extra = fs.existsSync(LOCAL) ? fs.readFileSync(LOCAL, 'utf8').split('\n').map(s => s.trim()).filter(Boolean) : [];
const PERSONAL = new RegExp(['/Users/[^/\\s]+', '[\\w.+-]+@(gmail|icloud|outlook|yahoo)\\.com', ...extra].join('|'), 'i');

test('the payload carries no personal identifiers', () => {
  const hits = [];
  for (const rel of [...ours.map(f => 'vault/' + f), ...walk(path.join(ROOT, 'connectors')).map(f => 'connectors/' + f)]) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    text.split('\n').forEach((line, i) => { if (PERSONAL.test(line)) hits.push(rel + ':' + (i + 1) + ': ' + line.trim().slice(0, 80)); });
  }
  assert.deepEqual(hits, []);
});

test('no stray hidden files ship: only .obsidian/ and .gitignore', () => {
  const allowed = f => f === '.gitignore' || /^\.obsidian\/(?!.*\/\.)/.test(f);
  assert.deepEqual(files.filter(f => f.split('/').some(part => part.startsWith('.')) && !allowed(f)), []);
});

test('no code ships into the vault outside Obsidian plugins', () => {
  assert.deepEqual(ours.filter(f => /\.(c|m)?js$|\.sh$|\.py$/.test(f)), []);
});

test('every shipped AGENTS.md points at its owner override', () => {
  const missing = files.filter(f => path.basename(f) === 'AGENTS.md')
    .filter(f => !fs.readFileSync(path.join(VAULT, f), 'utf8').includes('if an `AGENTS.local.md` sits beside this file, read it next'));
  assert.deepEqual(missing, []);
});

test('core connectors parse', () => {
  const { connectors, problems } = discover(path.join(ROOT, 'no-such-vault'));
  assert.deepEqual(problems, []);
  assert.ok(connectors.some(c => c.name === 'youtube'));
});

test('the LCARS theme is generated from the pinned design system and up to date', () => {
  const r = require('node:child_process').spawnSync(process.execPath, [path.join(ROOT, 'theme/build.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const css = fs.readFileSync(path.join(VAULT, '.obsidian/themes/LCARS/theme.css'), 'utf8');
  // Colors come from roles: no hex outside the generated role variables.
  const stray = css.split('\n').filter(l => /#[0-9a-f]{3,6}\b/i.test(l) && !/^\s*--lcars-[a-z0-9-]+: #/.test(l) && !/#000;/.test(l));
  assert.deepEqual(stray, []);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '../bin/lcars.js');
// cwd is a scratch folder: a parsing bug that falls back to "here" must never write into the repo.
const lcars = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'lcars-cwd-')) });

test('a mistyped flag is an error, never a real run', () => {
  const r = lcars('collect', '--dryrun');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unknown option: --dryrun/);
});

test('--key=value works, and init without --yes in a pipe writes nothing', () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'lcars-cli-'));
  const r = lcars('init', '--vault=' + vault);
  assert.match(r.stdout, /run again with --yes/);
  assert.equal(fs.existsSync(path.join(vault, '.lcars')), false);
  assert.equal(lcars('init', '--vault=' + vault, '--yes').status, 0);
  assert.match(lcars('upgrade', '--vault', vault).stdout, /Up to date\./);
});

test('upgrade refuses to go back to an older lcars without --force', () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'lcars-cli-'));
  lcars('init', '--vault', vault, '--yes');
  const file = path.join(vault, '.lcars/install.json');
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  record.core.version = '99.0.0';
  fs.writeFileSync(file, JSON.stringify(record));
  const r = lcars('upgrade', '--vault', vault, '--yes');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /newer than this lcars/);
});

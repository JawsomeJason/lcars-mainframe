'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { command } = require('../lib/schedule');
const { localDate } = require('../lib/collect');

test('the env-file wrapper loads the file, even one whose last command fails, and runs collect', () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'lcars sched '));
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true }); fs.writeFileSync(path.join(vault, rel), text); };
  write('00 Human/80 Templates/Daily.md', '---\nsecret_len:\n---\n');
  write('local/connectors/s/connector.json', JSON.stringify({ properties: ['secret_len'], run: ['node', 'run.cjs'], env: ['LCARS_TEST_SECRET'] }));
  write('local/connectors/s/run.cjs', 'console.log(process.env.LCARS_TEST_SECRET.length)');
  const envFile = path.join(vault, 'env file.sh');
  fs.writeFileSync(envFile, 'export LCARS_TEST_SECRET=abcd\n[ -f /no/such/file ] && echo never\n');
  const [cmd, ...args] = command(vault, envFile);
  const r = spawnSync(cmd, args, { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: os.homedir() } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^secret_len: 4$/m);
  assert.match(fs.readFileSync(path.join(vault, '00 Human/10 Daily Notes', localDate() + '.md'), 'utf8'), /^secret_len: 4$/m);
});

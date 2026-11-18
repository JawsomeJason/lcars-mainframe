'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { command, install, restart, readJob } = require('../lib/schedule');
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

test('restart keeps the installed time and env file, and takes the flags when given', { skip: process.platform !== 'darwin' && 'launchd job files are macOS only' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcars restart '));
  const vault = path.join(dir, 'vault');
  const envFile = path.join(dir, 'env.sh');
  fs.writeFileSync(envFile, 'export A=1\n');
  const saved = process.env.HOME;
  process.env.HOME = path.join(dir, 'home'); // no real launchd or LaunchAgents: dry runs only
  try {
    assert.throws(() => restart(vault, { dryRun: true }), /No schedule installed.*lcars start/);
    const [, file, body] = install(vault, { at: '06:30', envFile, dryRun: true }).match(/^Would write (.*?):\n([\s\S]*)$/);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body.split(process.execPath).join('/old/node').replace(/<key>PATH<\/key><string>[^<]*/, '<key>PATH</key><string>/old/bin'));
    const kept = restart(vault, { dryRun: true });
    assert.match(kept, /<integer>6<\/integer><key>Minute<\/key><integer>30<\/integer>/);
    assert.ok(kept.includes('<string>' + envFile + '</string>'));
    assert.ok(kept.includes('<string>' + process.execPath + '</string>') && !kept.includes('/old/node') && !kept.includes('/old/bin'), 'node and PATH are re-pinned');
    assert.match(restart(vault, { at: '08:15', dryRun: true }), /<integer>8<\/integer><key>Minute<\/key><integer>15<\/integer>/);
    // The same folder reached through a symlink is the same vault: its job is updated in place, never duplicated.
    fs.mkdirSync(vault);
    const link = path.join(dir, 'link');
    fs.symlinkSync(vault, link);
    for (const again of [install(link, { dryRun: true }), restart(link, { dryRun: true })]) {
      assert.ok(again.startsWith('Would write ' + file + ' (this folder is already scheduled as ' + vault + ';'), again);
      assert.ok(again.includes('<string>' + vault + '</string>') && !again.includes(link), 'keeps the pinned path');
      assert.ok(again.includes('<key>Label</key><string>' + path.basename(file, '.plist') + '</string>'), 'keeps the label');
    }
    assert.equal(readJob(link).file, file);
    assert.deepEqual(readJob(vault), { ...readJob(vault), at: '06:30', envFile, node: '/old/node' });
  } finally { process.env.HOME = saved; }
});

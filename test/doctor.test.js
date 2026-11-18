'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const doctor = require('../lib/doctor');
const schedule = require('../lib/schedule');
const { localDate, DAILY_DIR } = require('../lib/collect');

const NOW = new Date(2026, 10, 18, 12);
const darwin = { skip: process.platform !== 'darwin' && 'launchd job files are macOS only' };
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

/** A throwaway vault and HOME. `values` is the property for today, yesterday, ...; undefined means no note that day. */
function setup({ values, connector = { properties: ['subs'], run: ['node', 'run.cjs'] }, job = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcars-doctor-'));
  const vault = path.join(dir, 'vault'), home = path.join(dir, 'home');
  write(path.join(vault, '00 Human/80 Templates/Daily.md'), '---\nsubs:\n---\n');
  write(path.join(vault, '.lcars/install.json'), JSON.stringify({ format: 1, core: { name: 'lcars-mainframe', version: '1.0.0' }, files: {} }));
  if (connector) write(path.join(vault, 'local/connectors/c/connector.json'), JSON.stringify(connector));
  (values || []).forEach((v, i) => {
    if (v !== undefined) write(path.join(vault, DAILY_DIR, localDate(new Date(2026, 10, 18 - i)) + '.md'), '---\nsubs: ' + v + '\n---\n');
  });
  const saved = process.env.HOME;
  process.env.HOME = home;
  try {
    if (job) {
      // Reuse install's own plist: its dry run prints the file it would write, then the body.
      const [, file, body] = schedule.install(vault, { at: job.at || '07:00', envFile: job.envFile, dryRun: true }).match(/^Would write (.*?):\n([\s\S]*)$/);
      write(file, body.split(process.execPath).join(job.node || process.execPath));
      const log = schedule.readJob(vault).log;
      write(log, 'Wrote 1 value(s)\n');
      const when = new Date(NOW - (job.logAgeHours ?? 1) * 36e5);
      fs.utimesSync(log, when, when);
    }
  } finally { process.env.HOME = saved; }
  return { dir, vault, home, run: (opts = {}) => {
    let out = '';
    process.env.HOME = home;
    try { const code = doctor({ vault, version: '1.0.0', now: NOW, launchd: () => ({ lastExit: 0 }), write: s => { out += s; }, ...opts }); return { code, out }; }
    finally { process.env.HOME = saved; }
  } };
}
const days = (n, v) => Array.from({ length: n }, (_, i) => v + i); // a number that changes every day

test('doctor passes a healthy vault and job, and says so', darwin, () => {
  const { run } = setup({ values: days(14, 100) });
  const { code, out } = run();
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /✗/);
  assert.match(out, /✓ schedule: every pinned path exists/);
  assert.match(out, /✓ subs: local\/c can run/);
  assert.match(out, /All checks passed\./);
});

test('doctor fails, with the fix, when the pinned node no longer exists', darwin, () => {
  const { run } = setup({ values: days(14, 100), job: { node: '/no/such/node' } });
  const { code, out } = run();
  assert.equal(code, 1);
  assert.match(out, /✗ schedule pins a node that no longer exists: \/no\/such\/node\n    fix: lcars restart/);
});

test('doctor fails when the log is older than 25 hours', darwin, () => {
  const { run } = setup({ values: days(14, 100), job: { logAgeHours: 30 } });
  const { code, out } = run();
  assert.equal(code, 1);
  assert.match(out, /✗ last run: log last written 30h ago/);
});

test('doctor fails when the job is not loaded or its last run failed', darwin, () => {
  const { run } = setup({ values: days(14, 100) });
  assert.match(run({ launchd: () => null }).out, /✗ schedule: job is not loaded in launchd\n    fix: lcars restart/);
  assert.match(run({ launchd: () => ({ lastExit: 78 }) }).out, /✗ schedule: the last run exited with 78/);
});

test('doctor fails on a blank streak when a connector exists, but not for a hand-typed property', darwin, () => {
  const blank = [undefined, undefined, ...days(12, 100)];
  const withConnector = setup({ values: blank }).run();
  assert.equal(withConnector.code, 1);
  assert.match(withConnector.out, /✗ subs: blank 2 day\(s\) in a row\n    fix: `lcars collect --only c --dry-run`/);
  const byHand = setup({ values: ['unknown', 'unknown', ...days(12, 100)], connector: null }).run();
  assert.equal(byHand.code, 0, byHand.out);
  assert.match(byHand.out, /- subs: blank 2 day\(s\) in a row/);
});

test('doctor warns, without failing, on a number unchanged for 7 days', darwin, () => {
  const { code, out } = setup({ values: [5, 5, 5, 5, 5, 5, 5, 4, 3, 2, 1, 0, 9, 8] }).run();
  assert.equal(code, 0, out);
  assert.match(out, /! subs: unchanged 7 days in a row/);
});

test('doctor reads required env names from the job env file and prints names, never values', darwin, () => {
  const connector = { properties: ['subs'], run: ['node', 'run.cjs'], env: ['LCARS_DOCTOR_SET', 'LCARS_DOCTOR_MISSING'], bin: ['node'] };
  const envFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lcars-doctor-env-')), 'env.sh');
  write(envFile, 'export LCARS_DOCTOR_SET=hunter2-secret\n');
  const { code, out } = setup({ values: ['unknown', ...days(13, 100)], connector, job: { envFile } }).run();
  assert.equal(code, 1);
  assert.match(out, /cannot run: Missing environment variable: LCARS_DOCTOR_MISSING\n/);
  assert.doesNotMatch(out, /LCARS_DOCTOR_SET|hunter2/);
  fs.writeFileSync(envFile, 'export LCARS_DOCTOR_SET=hunter2-secret LCARS_DOCTOR_MISSING=x\n');
  const fixed = setup({ values: days(14, 100), connector, job: { envFile } }).run();
  assert.equal(fixed.code, 0, fixed.out);
  assert.doesNotMatch(fixed.out, /hunter2/);
});

test('without launchd, doctor reports the schedule as not supported and still checks the rest', () => {
  const { code, out } = setup({ values: days(14, 100), job: null }).run({ platform: 'linux' });
  assert.equal(code, 0, out);
  assert.match(out, /- schedule: not supported on linux/);
  assert.match(out, /✓ subs: local\/c can run/);
});

test('doctor warns when the vault is older than this lcars, and fails when it has no job', () => {
  const { run } = setup({ values: days(14, 100), job: null });
  const old = run({ version: '1.1.0', platform: 'darwin' });
  assert.match(old.out, /! vault has lcars 1.0.0, this lcars is 1.1.0\n    fix: lcars upgrade/);
  assert.match(old.out, /✗ schedule: no job file at .*\n    fix: lcars start/);
  assert.equal(old.code, 1);
});

test('a blank number today fails only once the scheduled time has passed; yesterday always counts', darwin, () => {
  const early = setup({ values: [undefined, ...days(13, 100)], job: { at: '18:00' } }).run(); // NOW is 12:00
  assert.equal(early.code, 0, early.out);
  assert.doesNotMatch(early.out, /blank/);
  const late = setup({ values: [undefined, ...days(13, 100)], job: { at: '11:59' } }).run();
  assert.equal(late.code, 1);
  assert.match(late.out, /✗ subs: blank 1 day\(s\) in a row/);
  const before = setup({ values: [undefined, undefined, ...days(12, 100)], job: { at: '18:00' } }).run();
  assert.equal(before.code, 1);
  assert.match(before.out, /✗ subs: blank 1 day\(s\) in a row/); // yesterday only: today is not counted yet
  const yesterday = setup({ values: [101, undefined, ...days(12, 100)] }).run();
  assert.equal(yesterday.code, 1);
  assert.match(yesterday.out, /✗ subs: blank yesterday/);
});

test('a missing env name is a warning when the last run filled the number, a failure when it did not', darwin, () => {
  const connector = { properties: ['subs'], run: ['node', 'run.cjs'], env: ['LCARS_DOCTOR_KEYCHAIN'] };
  const filled = setup({ values: days(14, 100), connector }).run();
  assert.equal(filled.code, 0, filled.out);
  assert.match(filled.out, /! subs: local\/c: LCARS_DOCTOR_KEYCHAIN missing in this shell, but the last run filled subs; a locked keychain over ssh does this/);
  const early = setup({ values: [undefined, ...days(13, 100)], connector, job: { at: '18:00' } }).run(); // before the run: yesterday is the last run
  assert.equal(early.code, 0, early.out);
  assert.match(early.out, /! subs: .*missing in this shell/);
  const blank = setup({ values: ['unknown', ...days(13, 100)], connector }).run();
  assert.equal(blank.code, 1);
  assert.match(blank.out, /✗ subs: local\/c cannot run: Missing environment variable: LCARS_DOCTOR_KEYCHAIN/);
});

test('doctor finds the job of a vault reached through a symlink', darwin, () => {
  const { dir, vault, home, run } = setup({ values: days(14, 100) });
  const link = path.join(dir, 'link');
  fs.symlinkSync(vault, link);
  const saved = process.env.HOME;
  process.env.HOME = home;
  try { assert.equal(schedule.readJob(link).vault, vault); } finally { process.env.HOME = saved; }
  const { code, out } = run({ vault: link });
  assert.equal(code, 0, out);
  assert.match(out, new RegExp('✓ schedule: job file .*, daily at 07:00, installed for ' + vault + ' \\(the same folder\\)'));
});

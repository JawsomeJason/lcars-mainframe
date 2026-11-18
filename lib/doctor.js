'use strict';
// Read-only health check: one line per check, and the fix under each failure.
// It writes nothing and prints names, paths and counts, never a value from the job's environment.
const fs = require('node:fs');
const path = require('node:path');
const sync = require('./sync');
const schedule = require('./schedule');
const { discover, providers, trackedProperties, blocker, getProperty, localDate, DAILY_DIR } = require('./collect');

const DAYS = 14;
const STALE_HOURS = 25;
const FROZEN_DAYS = 7;
const isBlank = v => !v || ['unknown', '""', "''", 'null'].includes(v);

/** @returns {number} 1 when any check fails (warnings do not), else 0 */
function doctor({ vault, version, now = new Date(), platform = process.platform, launchd = schedule.launchState, write = s => process.stdout.write(s) }) {
  let failed = 0;
  const report = (mark, text, fix) => {
    if (mark === '✗') failed++;
    write(mark + ' ' + text + '\n' + (fix ? '    fix: ' + fix + '\n' : ''));
  };

  let record;
  try { record = sync.readRecord(vault); } catch (error) { report('✗', 'vault ' + vault + ': ' + error.message, 'lcars upgrade, or repair .lcars/install.json'); }
  if (!record && !failed) report('✗', 'vault ' + vault + ' has no install record', 'lcars init ' + vault);
  else if (!record) { /* reported above */ } else if (sync.newer(version, record.core.version)) report('!', 'vault has lcars ' + record.core.version + ', this lcars is ' + version, 'lcars upgrade');
  else if (sync.newer(record.core.version, version)) report('!', 'vault has lcars ' + record.core.version + ', newer than this lcars (' + version + ')', 'install a newer lcars-mainframe');
  else report('✓', 'vault ' + vault + ' (lcars ' + version + ')');

  let job = null;
  if (platform !== 'darwin') report('-', 'schedule: not supported on ' + platform + ' (no launchd); `lcars start` prints a crontab line');
  else {
    let broken = false;
    try { job = schedule.readJob(vault); } catch (error) { broken = true; report('✗', 'schedule: ' + schedule.agent(vault) + ' is unreadable (' + error.message + ')', 'lcars restart'); }
    if (!job && !broken) report('✗', 'schedule: no job file at ' + schedule.agent(vault), 'lcars start');
  }
  if (job) {
    report('✓', 'schedule: job file ' + job.file + ', daily at ' + job.at + (job.vault === vault ? '' : ', installed for ' + job.vault + ' (the same folder)'));
    const state = launchd(job);
    if (!state) report('✗', 'schedule: job is not loaded in launchd', 'lcars restart');
    else if (state.lastExit) report('✗', 'schedule: the last run exited with ' + state.lastExit, 'read ' + job.log + ' for the error');
    else report('✓', 'schedule: loaded in launchd, ' + (state.lastExit === 0 ? 'last exit 0' : 'not run yet'));
    const gone = [['node', job.node, 'lcars restart'], ['lcars.js', job.bin, 'lcars restart'], ['vault', job.vault, 'restore it, or `lcars stop`'], ['env file', job.envFile, 'recreate it, or `lcars restart --env-file <file>`']]
      .filter(([, p]) => p && !fs.existsSync(p));
    for (const [what, p, fix] of gone) report('✗', 'schedule pins a ' + what + ' that no longer exists: ' + p, fix);
    if (!gone.length) report('✓', 'schedule: every pinned path exists');

    const log = fs.statSync(job.log, { throwIfNoEntry: false });
    const hours = log && (now - log.mtimeMs) / 36e5;
    if (!log) report('!', 'last run: no log yet at ' + job.log);
    else if (hours > STALE_HOURS) report('✗', 'last run: log last written ' + Math.floor(hours) + 'h ago', 'read ' + job.log + ', then `lcars collect`');
    else report('✓', 'last run: log written ' + Math.floor(hours) + 'h ago');
  }

  const env = job ? schedule.jobEnv(job) : process.env; // the job's own environment, or ours when there is no job
  const { connectors, problems } = discover(vault);
  for (const problem of problems) report('✗', 'connector: ' + problem, 'fix that connector.json');
  const map = providers(connectors);
  const notes = Array.from({ length: DAYS }, (_, i) => {
    const file = path.join(vault, DAILY_DIR, localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)) + '.md');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  });
  const [hour, minute] = (job ? job.at : '07:00').split(':').map(Number);
  const due = now >= new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute); // before the run, today is not late yet
  // Can this connector run in the job's environment? A missing key is only a warning when the last run did fill what it makes.
  const canRun = (name, c, filled, what) => {
    const binWhy = blocker({ ...c, env: [] }, env);
    const missing = c.env.filter(key => !env[key]);
    const why = binWhy || (missing.length && blocker(c, env));
    if (!why) report('✓', name + ' can run');
    else if (!binWhy && filled) report('!', name + ': ' + missing.join(', ') + ' missing in this shell, but the last run filled ' + what + '; a locked keychain over ssh does this');
    else report('✗', name + ' cannot run: ' + why, binWhy ? 'install it, then `lcars restart` to re-pin PATH' : 'export it in ' + (job && job.envFile || 'an env file') + ', then `lcars restart' + (job && job.envFile ? '' : ' --env-file <file>') + '`');
  };
  for (const property of trackedProperties(vault)) {
    const values = notes.map(text => text === null ? undefined : (v => isBlank(v) ? undefined : v)(getProperty(text, property)));
    const entry = map.get(property);
    const c = entry && entry.connector;
    if (!entry) report('-', property + ': typed by hand, no connector');
    else if (!c) report('✗', property + ': ' + entry.error, 'leave one connector per property');
    // The most recent run that should have happened: today's once it is due, or as soon as today is filled (an early run counts).
    const lastRun = due || values[0] !== undefined ? 0 : 1;
    if (c) canRun(property + ': ' + c.source + '/' + c.name, c, values[lastRun] !== undefined, property);

    const run = (from, same) => { let n = 0; while (from + n < DAYS && same(values[from + n])) n++; return n; };
    const lead = run(lastRun, v => v === undefined);
    const first = values.findIndex(v => v !== undefined);
    const frozen = first < 0 ? 0 : run(first, v => v === values[first]);
    const look = c ? '`lcars collect --only ' + c.name + ' --dry-run` shows why' : 'type it in today\'s note';
    const isNew = values.slice(1).every(v => v === undefined); // first filled today: yesterday could not have had it
    if (lead || (values[1] === undefined && !isNew)) {
      const text = property + ': ' + (lead ? 'blank ' + lead + ' day(s) in a row' : 'blank yesterday');
      if (c) report('✗', text, look); else report('-', text);
    }
    if (frozen >= FROZEN_DAYS) report('!', property + ': unchanged ' + frozen + ' days in a row, a frozen number is often a stale source', look);
    else if (first >= 0 && !lead && (values[1] !== undefined || isNew)) report('✓', property + ': filled, unchanged ' + frozen + ' day(s)');
  }

  for (const c of connectors.filter(x => x.journal)) {
    const tag = ' [' + c.journal + '] ';
    canRun('journal ' + c.journal + ': ' + c.source + '/' + c.name, c, notes.some(text => text !== null && text.includes(tag)), 'its journal lines');
  }

  write(failed ? failed + ' check(s) failed.\n' : 'All checks passed.\n');
  return failed ? 1 : 0;
}

module.exports = doctor;

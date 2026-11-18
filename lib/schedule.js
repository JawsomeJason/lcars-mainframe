'use strict';
// Runs `lcars collect` on a timer: a launchd agent on macOS, a crontab line elsewhere.
// launchd and cron load no shell profile, so PATH is captured now and secrets come
// from one env file sourced in the owner's shell.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'lcars.js');

function command(vault, envFile) {
  const direct = [process.execPath, BIN, 'collect', '--vault', vault];
  if (!envFile) return direct;
  const shell = process.env.SHELL || '/bin/sh';
  return [shell, '-c', '. "$1"; exec "$2" "$3" collect --vault "$4"', 'lcars', envFile, process.execPath, BIN, vault];
}

function label(vault) {
  return 'lcars.collect.' + crypto.createHash('sha256').update(vault).digest('hex').slice(0, 8);
}

const agent = vault => path.join(os.homedir(), 'Library/LaunchAgents', label(vault) + '.plist');

const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function plist(vault, { hour, minute, envFile, id = label(vault) }) {
  const log = path.join(os.homedir(), 'Library/Logs', id + '.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${id}</string>
  <key>ProgramArguments</key>
  <array>
${command(vault, envFile).map(a => '    <string>' + xml(a) + '</string>').join('\n')}
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${xml(process.env.PATH || '/usr/bin:/bin')}</string></dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
}

function parseAt(at = '07:00') {
  const match = String(at).match(/^(\d{1,2}):(\d{2})$/);
  if (!match || +match[1] > 23 || +match[2] > 59) throw Error('--at takes a 24-hour time such as 07:00.');
  return { hour: +match[1], minute: +match[2] };
}

/** @returns {string} what was done, for the CLI to print */
function install(vault, { at, envFile, dryRun }) {
  at = at || '07:00';
  const time = parseAt(at);
  if (envFile) {
    envFile = path.resolve(envFile.replace(/^~(?=\/|$)/, os.homedir()));
    if (!fs.existsSync(envFile)) throw Error('No env file at ' + envFile + '.');
  }
  if (process.platform !== 'darwin') {
    const line = time.minute + ' ' + time.hour + ' * * * ' + command(vault, envFile).map(a => "'" + a.replace(/'/g, "'\\''").replace(/%/g, '\\%') + "'").join(' ');
    return 'Add this line with `crontab -e`:\n' + line;
  }
  // A vault reached by another path (a symlink) is the same vault: update its job in place, keeping the label.
  const job = found(vault);
  const via = job && job.vault !== vault ? ' (this folder is already scheduled as ' + job.vault + '; that job is updated, not duplicated)' : '';
  if (job) vault = job.vault;
  const file = job ? job.file : agent(vault);
  const body = plist(vault, { ...time, envFile, id: path.basename(file, '.plist') });
  if (dryRun) return 'Would write ' + file + via + ':\n' + body;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  const domain = 'gui/' + process.getuid();
  spawnSync('launchctl', ['bootout', domain, file]);
  const loaded = spawnSync('launchctl', ['bootstrap', domain, file], { encoding: 'utf8' });
  if (loaded.status !== 0) throw Error('launchctl bootstrap failed: ' + (loaded.stderr || loaded.status));
  return 'Scheduled `lcars collect` daily at ' + at + ' (' + file + ')' + via + '.';
}

function remove(vault) {
  if (process.platform !== 'darwin') return 'Remove the lcars line with `crontab -e`.';
  const job = found(vault);
  if (!job) return 'Nothing scheduled for this vault.';
  const file = job.file;
  spawnSync('launchctl', ['bootout', 'gui/' + process.getuid(), file]);
  fs.rmSync(file);
  return 'Removed ' + file + '.';
}

/** Install again, keeping the installed job's time and env file unless told otherwise; node and PATH are re-pinned to now. */
function restart(vault, { at, envFile, dryRun }) {
  if (process.platform === 'darwin') {
    const job = readJob(vault);
    if (!job) throw Error('No schedule installed for this vault. Use `lcars start`.');
    at = at || job.at;
    envFile = envFile || job.envFile;
  }
  return install(vault, { at, envFile, dryRun });
}

/**
 * The installed job for this vault, or null. A job counts when it pins the same real path, so a symlinked
 * vault finds the job installed under the other name. Throws when this vault's own job file is not one of ours.
 */
function readJob(vault) {
  const own = agent(vault);
  if (fs.existsSync(own)) return parseJob(own);
  const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const dir = path.dirname(own);
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!/^lcars\.collect\..+\.plist$/.test(name)) continue;
    try { const job = parseJob(path.join(dir, name)); if (real(job.vault) === real(vault)) return job; } catch { /* not ours */ }
  }
  return null;
}

const found = vault => { try { return readJob(vault); } catch { return null; } };

function parseJob(file) {
  const text = fs.readFileSync(file, 'utf8');
  const unxml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const pick = re => { const m = text.match(re); if (!m) throw Error('not an lcars job'); return unxml(m[1]); };
  const args = [...pick(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/).matchAll(/<string>([\s\S]*?)<\/string>/g)].map(m => m[1]);
  const wrapped = args[1] === '-c'; // the env-file form: shell -c script lcars envFile node bin vault
  const [hour, minute] = ['Hour', 'Minute'].map(k => String(pick(new RegExp('<key>' + k + '</key><integer>(\\d+)</integer>'))).padStart(2, '0'));
  return {
    file, at: hour + ':' + minute, log: pick(/<key>StandardOutPath<\/key><string>([\s\S]*?)<\/string>/), path: pick(/<key>PATH<\/key><string>([\s\S]*?)<\/string>/),
    shell: wrapped ? args[0] : undefined, envFile: wrapped ? args[4] : undefined,
    node: wrapped ? args[5] : args[0], bin: wrapped ? args[6] : args[1], vault: wrapped ? args[7] : args[4],
  };
}

/** launchd's view of the job: null when not loaded, else its last exit code (null before its first run). */
function launchState(job) {
  const out = spawnSync('launchctl', ['print', 'gui/' + process.getuid() + '/' + path.basename(job.file, '.plist')], { encoding: 'utf8' });
  if (out.status !== 0) return null;
  const code = out.stdout.match(/last exit code = (\d+)/);
  return { lastExit: code ? +code[1] : null };
}

/** What collect sees when the job runs: its PATH, plus what the env file exports. Values stay in memory; callers report names only. */
function jobEnv(job) {
  const env = { PATH: job.path, HOME: os.homedir() };
  if (!job.shell) return env;
  const out = spawnSync(job.shell, ['-c', '. "$1"; exec /usr/bin/env', 'lcars', job.envFile], { env, encoding: 'utf8', timeout: 10000 });
  for (const line of (out.stdout || '').split('\n')) { const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/); if (m) env[m[1]] = m[2]; }
  return env;
}

module.exports = { install, remove, restart, command, agent, readJob, launchState, jobEnv };

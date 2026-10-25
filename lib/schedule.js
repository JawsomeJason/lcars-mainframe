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

const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function plist(vault, { hour, minute, envFile }) {
  const log = path.join(os.homedir(), 'Library/Logs', label(vault) + '.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label(vault)}</string>
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
  const file = path.join(os.homedir(), 'Library/LaunchAgents', label(vault) + '.plist');
  const body = plist(vault, { ...time, envFile });
  if (dryRun) return 'Would write ' + file + ':\n' + body;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  const domain = 'gui/' + process.getuid();
  spawnSync('launchctl', ['bootout', domain, file]);
  const loaded = spawnSync('launchctl', ['bootstrap', domain, file], { encoding: 'utf8' });
  if (loaded.status !== 0) throw Error('launchctl bootstrap failed: ' + (loaded.stderr || loaded.status));
  return 'Scheduled `lcars collect` daily at ' + at + ' (' + file + ').';
}

function remove(vault) {
  if (process.platform !== 'darwin') return 'Remove the lcars line with `crontab -e`.';
  const file = path.join(os.homedir(), 'Library/LaunchAgents', label(vault) + '.plist');
  if (!fs.existsSync(file)) return 'Nothing scheduled for this vault.';
  spawnSync('launchctl', ['bootout', 'gui/' + process.getuid(), file]);
  fs.rmSync(file);
  return 'Removed ' + file + '.';
}

module.exports = { install, remove, command };

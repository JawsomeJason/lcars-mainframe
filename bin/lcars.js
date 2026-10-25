#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline/promises');
const { spawnSync } = require('node:child_process');
const sync = require('../lib/sync');
const { collect, discover, providers, trackedProperties, blocker } = require('../lib/collect');
const schedule = require('../lib/schedule');
const pkg = require('../package.json');

const PAYLOAD = path.join(__dirname, '..', 'vault');
const CORE = { name: pkg.name, version: pkg.version };

const HELP = `lcars ${pkg.version}: install, upgrade and run a Memory Alpha vault.

  lcars init [dir]                  install the core into dir (default: here); never overwrites a file
  lcars upgrade                     bring this vault up to lcars ${pkg.version}, merging your edits
  lcars status                      version, edited core files, pending .new files, connectors
  lcars collect [--only <name>]     fill today's daily note from the connectors
  lcars schedule install [--at HH:MM] [--env-file <file>]
  lcars schedule remove

  --vault <dir>   the vault (default: the nearest folder above here with .lcars/)
  --dry-run       show what would happen, write nothing
  --yes           apply without asking (needed when not run in a terminal)
  --force         allow upgrade to go back to an older lcars`;

const VALUED = new Set(['vault', 'only', 'at', 'env-file']);
const BOOLEAN = new Set(['dry-run', 'yes', 'force', 'version', 'help']);

/** Unknown flags are errors: a typo like --dryrun must never fall through to a real write. */
function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { opts._.push(arg); continue; }
    const [name, inline] = arg.slice(2).split(/=(.*)/s);
    if (VALUED.has(name)) {
      const value = inline !== undefined ? inline : argv[++i];
      if (value === undefined || value === '') throw Error('--' + name + ' needs a value.');
      opts[name] = value;
    } else if (BOOLEAN.has(name) && inline === undefined) opts[name] = true;
    else throw Error('Unknown option: ' + arg + '\n\n' + HELP);
  }
  return opts;
}

function findVault(opts) {
  if (opts.vault) return path.resolve(opts.vault);
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, sync.RECORD))) return dir;
    if (dir === path.dirname(dir)) throw Error('Not inside an lcars vault. Run `lcars init` or pass --vault <dir>.');
  }
}

/** Whether version a is newer than b (plain x.y.z). */
function newer(a, b) {
  const [x, y] = [a, b].map(v => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

const LABEL = {
  create: 'add', record: 'track', keep: 'keep yours', 'keep-deleted': 'stays deleted', replace: 'update',
  merge: 'merge', conflict: 'CONFLICT', delete: 'remove', orphan: 'yours now', forget: 'untrack',
};

function diff(a, b, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcars-diff-'));
  try {
    const [x, y] = [path.join(dir, 'a'), path.join(dir, 'b')];
    fs.writeFileSync(x, a || ''); fs.writeFileSync(y, b || '');
    const out = spawnSync('git', ['diff', '--no-index', '--no-color', '-U2', x, y], { encoding: 'utf8' });
    if (out.error) return '';
    return out.stdout.split('\n').slice(4).join('\n').replace(/\n$/, '').replace(/^/, '--- ' + label + '\n');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function preview(vault, actions) {
  const shown = actions.filter(a => a.kind !== 'noop');
  for (const a of shown) process.stdout.write(LABEL[a.kind].padEnd(14) + a.path + (a.note ? '  (' + a.note + ')' : '') + '\n');
  for (const a of shown) {
    if (!['replace', 'merge', 'conflict'].includes(a.kind)) continue;
    const mine = fs.readFileSync(path.join(vault, a.path));
    const text = diff(mine, a.text, a.kind === 'conflict' ? a.path + ' (yours) vs ' + a.path + '.new (core)' : a.path);
    if (text) process.stdout.write('\n' + text + '\n');
  }
  return shown;
}

async function confirm(opts, question) {
  if (opts.yes) return true;
  if (!process.stdin.isTTY) { process.stdout.write('Not a terminal: run again with --yes to apply.\n'); return false; }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { return /^y(es)?$/i.test((await rl.question(question + ' [y/N] ')).trim()); } finally { rl.close(); }
}

async function syncCommand(vault, opts, mode) {
  const record = sync.readRecord(vault);
  if (mode === 'init' && record) throw Error('Already an lcars vault (' + record.core.version + '). Use `lcars upgrade`.');
  if (mode === 'upgrade' && !record) throw Error('No install record in ' + vault + '. Use `lcars init`.');
  if (record && newer(record.core.version, CORE.version) && !opts.force) {
    throw Error('This vault has lcars ' + record.core.version + ', newer than this lcars (' + CORE.version + '). Upgrade lcars, or pass --force to go back.');
  }
  const actions = sync.plan({ payloadDir: PAYLOAD, vault, record });
  const from = record ? record.core.version : 'nothing';
  process.stdout.write((mode === 'init' ? 'Install' : 'Upgrade') + ' lcars ' + from + ' -> ' + CORE.version + ' in ' + vault + '\n\n');
  const shown = preview(vault, actions);
  const versionChange = !record || record.core.version !== CORE.version;
  if (!shown.length && !versionChange) { process.stdout.write('Up to date.\n'); return 0; }
  if (opts['dry-run']) { process.stdout.write('\nDry run: nothing written.\n'); return 0; }
  if (!(await confirm(opts, '\nApply?'))) return 1;
  sync.apply({ vault, payloadDir: PAYLOAD, record, actions, core: CORE });
  const conflicts = actions.filter(a => a.kind === 'conflict');
  process.stdout.write('\nDone: lcars ' + CORE.version + '.\n');
  for (const a of conflicts) process.stdout.write('Merge by hand: ' + a.path + '.new holds the core version. Delete it when done.\n');
  return conflicts.length ? 2 : 0;
}

function status(vault) {
  const record = sync.readRecord(vault);
  if (!record) throw Error('No install record in ' + vault + '. Use `lcars init`.');
  let attention = 0;
  const out = s => process.stdout.write(s + '\n');
  out('Vault ' + vault + ': lcars ' + record.core.version + (record.core.version === CORE.version ? '' : ' (this lcars is ' + CORE.version + '; run `lcars upgrade`)'));
  const edited = sync.editedFiles(vault, record);
  out('\nCore files you changed (upgrades merge into these):' + (edited.length ? '' : ' none'));
  for (const e of edited) { out('  ' + e.state.padEnd(8) + ' ' + e.path); if (e.path.endsWith('.new')) attention++; }
  const { connectors, problems } = discover(vault);
  const map = providers(connectors);
  out('\nTracked properties (from the Daily template):');
  for (const p of trackedProperties(vault)) {
    const entry = map.get(p);
    if (!entry) { out('  ' + p + ': typed by hand'); continue; }
    if (entry.error) { out('  ' + p + ': ' + entry.error); attention++; continue; }
    const why = blocker(entry.connector);
    if (why) attention++;
    out('  ' + p + ': ' + entry.connector.source + '/' + entry.connector.name + (why ? '  (' + why + ')' : ''));
  }
  for (const problem of problems) { out('  problem: ' + problem); attention++; }
  return attention ? 1 : 0;
}

async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const [command, sub] = opts._;
  if (opts.version) { process.stdout.write(pkg.version + '\n'); return 0; }
  if (opts.help) { process.stdout.write(HELP + '\n'); return 0; }
  switch (command) {
    case 'init': {
      const vault = path.resolve(opts.vault || sub || '.');
      fs.mkdirSync(vault, { recursive: true });
      return syncCommand(vault, opts, 'init');
    }
    case 'upgrade': return syncCommand(findVault(opts), opts, 'upgrade');
    case 'status': return status(findVault(opts));
    case 'collect': {
      await collect({ vault: findVault(opts), dryRun: !!opts['dry-run'], only: opts.only });
      return 0;
    }
    case 'schedule': {
      const vault = findVault(opts);
      if (sub === 'install') process.stdout.write(schedule.install(vault, { at: opts.at, envFile: opts['env-file'], dryRun: !!opts['dry-run'] }) + '\n');
      else if (sub === 'remove') process.stdout.write(schedule.remove(vault) + '\n');
      else throw Error('Use `lcars schedule install` or `lcars schedule remove`.');
      return 0;
    }
    case undefined: case 'help': process.stdout.write(HELP + '\n'); return 0;
    default: throw Error('Unknown command: ' + command + '\n\n' + HELP);
  }
}

// A closed pipe (lcars status | head) is a normal end, not a crash.
process.stdout.on('error', error => { if (error.code === 'EPIPE') process.exit(0); throw error; });

main().then(code => { process.exitCode = code; }, error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });

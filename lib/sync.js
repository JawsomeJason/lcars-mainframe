'use strict';
// Install and upgrade: one planner over the package's vault/ (theirs), the
// install record, and the owner's vault (mine). See docs/design.md.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const RECORD_DIR = '.lcars';
const RECORD = path.join(RECORD_DIR, 'install.json');
const BASES = path.join(RECORD_DIR, 'base');
const LOCK = path.join(RECORD_DIR, 'lock');

/** @typedef {'seed'|'system'} FileClass */
/** @typedef {{class: FileClass, sha256?: string}} RecordEntry */
/** @typedef {{format: 1, core: {name: string, version: string}, files: Record<string, RecordEntry>}} InstallRecord */
/**
 * @typedef {'create'|'record'|'keep'|'keep-deleted'|'replace'|'merge'|'conflict'|'delete'|'orphan'|'forget'|'noop'} ActionKind
 * @typedef {{path: string, kind: ActionKind, class: FileClass, text?: Buffer, note?: string}} Action
 * text: what the vault file becomes (create/replace/merge), or the .new content (conflict).
 */

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

/**
 * Seeds are the owner's after the first write: Obsidian's settings, plugin settings, run logs.
 * Theme and plugin code are system files, so upgrades keep them current.
 * @param {string} rel a vault-relative path with forward slashes
 */
function classify(rel) {
  if (/^\.obsidian\/[^/]+$/.test(rel) || /^\.obsidian\/plugins\/[^/]+\/data\.json$/.test(rel)) return 'seed';
  if (rel === '.gitignore' || path.posix.basename(rel) === 'FINDINGS.md') return 'seed';
  return 'system';
}

/** Every file under dir, as forward-slash relative paths, sorted. */
function walk(dir) {
  const out = [];
  (function visit(rel) {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (entry.name === '.DS_Store') continue;
      const child = rel ? rel + '/' + entry.name : entry.name;
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) out.push(child);
    }
  })('');
  return out.sort();
}

function readMaybe(file) {
  try { return fs.readFileSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/** @returns {InstallRecord|null} */
function readRecord(vault) {
  const buf = readMaybe(path.join(vault, RECORD));
  if (!buf) return null;
  const record = JSON.parse(buf.toString('utf8'));
  if (record.format !== 1) throw Error('This vault was installed by a newer lcars (record format ' + record.format + '). Upgrade lcars first.');
  // A synced vault is untrusted input: a record path must stay inside the vault.
  for (const key of Object.keys(record.files)) {
    if (path.posix.isAbsolute(key) || key.includes('\\') || key.split('/').some(part => part === '..' || part === '') || key.startsWith(RECORD_DIR + '/')) {
      throw Error(RECORD + ' lists a path outside the vault: ' + JSON.stringify(key) + '. Fix or delete that entry.');
    }
  }
  return record;
}

/** Sorted keys, two spaces, final newline: an unchanged record serializes to the same bytes. */
function serializeRecord(record) {
  const files = {};
  for (const key of Object.keys(record.files).sort()) files[key] = record.files[key];
  return JSON.stringify({ format: 1, core: record.core, files }, null, 2) + '\n';
}

/** The base text for a recorded hash, or null when it is missing or does not match its hash. */
function readBase(vault, hash) {
  const buf = hash && readMaybe(path.join(vault, BASES, hash));
  return buf && sha256(buf) === hash ? buf : null;
}

/**
 * 3-way merge with `git merge-file` on temp copies.
 * @returns {{clean: true, text: Buffer}|{clean: false, reason: string}}
 */
function merge3(base, mine, theirs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcars-merge-'));
  try {
    const [m, b, t] = ['mine', 'base', 'theirs'].map(name => path.join(dir, name));
    fs.writeFileSync(m, mine); fs.writeFileSync(b, base); fs.writeFileSync(t, theirs);
    const result = spawnSync('git', ['merge-file', '-p', m, b, t], { maxBuffer: 64 * 1024 * 1024 });
    if (result.error) return { clean: false, reason: 'git is not installed, so edits cannot be merged automatically' };
    if (result.status === 0) return { clean: true, text: result.stdout };
    return { clean: false, reason: result.status > 0 ? 'your edit and the core change touch the same lines' : 'git merge-file failed' };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Pure apart from reading files: decide one action per path. Never writes.
 * @param {{payloadDir: string, vault: string, record: InstallRecord|null}} input
 * @returns {Action[]}
 */
function plan({ payloadDir, vault, record }) {
  const files = record ? record.files : {};
  const theirsPaths = new Set(walk(payloadDir));
  const theirsLower = new Set([...theirsPaths].map(p => p.toLowerCase()));
  const paths = [...new Set([...theirsPaths, ...Object.keys(files)])].sort();
  return paths.map(rel => {
    // A path the core reclassified is planned as if new, so a former seed starts being upgraded.
    const recorded = files[rel];
    const cls = theirsPaths.has(rel) ? classify(rel) : recorded.class;
    const entry = recorded && recorded.class === cls ? recorded : undefined;
    const theirs = theirsPaths.has(rel) ? fs.readFileSync(path.join(payloadDir, rel)) : null;
    const mine = readMaybe(path.join(vault, rel));
    // mineHash lets apply() refuse to write over a file that changed after the plan was shown.
    const act = (kind, extra) => ({ path: rel, kind, class: cls, mineHash: mine && sha256(mine), ...extra });

    if (!theirs) {
      // Core dropped the file. A case-only rename is the same file on macOS and Windows: never delete it.
      if (cls === 'seed' || !mine || theirsLower.has(rel.toLowerCase())) return act('forget');
      const base = readBase(vault, entry.sha256);
      return base && base.equals(mine) ? act('delete') : act('orphan', { note: 'you edited it and the core no longer ships it; it is yours now' });
    }
    if (cls === 'seed') {
      if (entry) return act('noop');
      return mine ? act('record') : act('create', { text: theirs });
    }
    const theirsHash = sha256(theirs);
    if (!entry) {
      if (!mine) return act('create', { text: theirs });
      return mine.equals(theirs) ? act('record') : act('keep', { note: 'your copy differs from the core; kept as your edit' });
    }
    if (!mine) return entry.sha256 === theirsHash ? act('noop') : act('keep-deleted');
    if (mine.equals(theirs)) return entry.sha256 === theirsHash ? act('noop') : act('record');
    const base = readBase(vault, entry.sha256);
    if (!base) return act('conflict', { text: theirs, note: 'the installed copy of the core version is missing' });
    if (mine.equals(base)) return act('replace', { text: theirs });
    if (theirs.equals(base)) return act('noop');
    const merged = merge3(base, mine, theirs);
    return merged.clean ? act('merge', { text: merged.text }) : act('conflict', { text: theirs, note: merged.reason });
  });
}

/** The record after applying a plan. Every kept path now points at the core text it was offered. */
function nextRecord(actions, payloadDir, core) {
  const files = {};
  for (const a of actions) {
    if (a.kind === 'delete' || a.kind === 'orphan' || a.kind === 'forget') continue;
    files[a.path] = a.class === 'seed'
      ? { class: 'seed' }
      : { class: 'system', sha256: sha256(fs.readFileSync(path.join(payloadDir, a.path))) };
  }
  return { format: 1, core, files };
}

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.lcars-tmp';
  fs.writeFileSync(temp, data);
  fs.renameSync(temp, file);
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

function withLock(vault, fn) {
  const lock = path.join(vault, LOCK);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const take = () => fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, host: os.hostname() }), { flag: 'wx' });
  try {
    take();
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let held = {};
    try { held = JSON.parse(fs.readFileSync(lock, 'utf8')); } catch {}
    if (held.host === os.hostname() && held.pid && !pidAlive(held.pid)) { fs.rmSync(lock, { force: true }); take(); }
    else throw Error('Another lcars run holds ' + LOCK + ' (pid ' + held.pid + ' on ' + held.host + '). Delete it if that run is gone.');
  }
  try { return fn(); } finally { fs.rmSync(lock, { force: true }); }
}

/**
 * Write a plan. Order: base blobs, vault files, record, blob cleanup, so a crash
 * at any point leaves the old record and its blobs intact for a rerun.
 * @returns {boolean} whether anything was written
 */
function apply({ vault, payloadDir, record, actions, core }) {
  const next = nextRecord(actions, payloadDir, core);
  const recordChanged = !record || serializeRecord(record) !== serializeRecord(next);
  const work = actions.filter(a => !['noop', 'record', 'keep', 'keep-deleted', 'forget', 'orphan'].includes(a.kind));
  if (!work.length && !recordChanged) return false;
  return withLock(vault, () => {
    const changed = work.filter(a => {
      const now = readMaybe(path.join(vault, a.path));
      return (now ? sha256(now) : null) !== (a.mineHash || null);
    });
    if (changed.length) throw Error('Changed since the plan was made, so nothing was written: ' + changed.map(a => a.path).join(', ') + '. Run it again.');
    for (const [rel, entry] of Object.entries(next.files)) {
      if (entry.sha256 && !readBase(vault, entry.sha256)) writeAtomic(path.join(vault, BASES, entry.sha256), fs.readFileSync(path.join(payloadDir, rel)));
    }
    for (const a of work) {
      const file = path.join(vault, a.path);
      if (a.kind === 'delete') fs.rmSync(file, { force: true });
      else if (a.kind === 'conflict') {
        // Never overwrite a .new the owner may be merging; offer this version beside it.
        const pending = readMaybe(file + '.new');
        if (!pending) writeAtomic(file + '.new', a.text);
        else if (!pending.equals(a.text)) writeAtomic(file + '.' + core.version + '.new', a.text);
      }
      else writeAtomic(file, a.text);
    }
    writeAtomic(path.join(vault, RECORD), serializeRecord(next));
    const keep = new Set(Object.values(next.files).map(e => e.sha256).filter(Boolean));
    const blobDir = path.join(vault, BASES);
    for (const name of fs.existsSync(blobDir) ? fs.readdirSync(blobDir) : []) if (!keep.has(name)) fs.rmSync(path.join(blobDir, name), { force: true });
    return true;
  });
}

/** Paths the owner has edited relative to the core text last installed. */
function editedFiles(vault, record) {
  const out = [];
  for (const [rel, entry] of Object.entries(record.files)) {
    if (entry.class !== 'system') continue;
    const mine = readMaybe(path.join(vault, rel));
    if (!mine) out.push({ path: rel, state: 'missing' });
    else if (sha256(mine) !== entry.sha256) out.push({ path: rel, state: 'edited' });
    const dir = path.dirname(path.join(vault, rel)), name = path.basename(rel);
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      if (f.startsWith(name + '.') && f.endsWith('.new')) out.push({ path: path.posix.join(path.posix.dirname(rel), f), state: 'core version waiting to be merged by hand' });
    }
  }
  return out;
}

module.exports = { classify, walk, plan, apply, merge3, readRecord, serializeRecord, editedFiles, sha256, RECORD };

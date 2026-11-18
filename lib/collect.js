'use strict';
// Runs the connectors for every tracked property and writes the readings into
// today's daily note. A failed reading is written as `unknown`, never 0.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DAILY_DIR = '00 Human/10 Daily Notes';
const TEMPLATE = '00 Human/80 Templates/Daily.md';
const CORE_CONNECTORS = path.join(__dirname, '..', 'connectors');
const PROPERTY = /^[a-z][a-z0-9_]*$/;
const MAX_OUTPUT = 5 * 1024 * 1024;
const MAX_LINES = 200; // journal lines per connector per run
const MAX_AGE_DAYS = 31;
const MAX_LINK = 2000;

/** @typedef {{name: string, dir: string, source: 'local'|'core', properties: string[], journal?: string, run: string[], env: string[], bin: string[], timeoutSeconds: number}} Connector */
/** @typedef {{property: string, value: number|'unknown', error?: string}} Reading */

function localDate(now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
}

function frontmatter(text) {
  const match = text.match(/^﻿?---\r?\n(?:([\s\S]*?)\r?\n)?---(?=\r?\n|$)/);
  return match && match[1] !== undefined ? match[1].split(/\r?\n/) : [];
}

/**
 * Tracked properties, in template order: top-level frontmatter keys left empty in
 * the Daily template. `tags:` followed by list items is a list, not a tracked number.
 */
function trackedProperties(vault) {
  const file = path.join(vault, TEMPLATE);
  if (!fs.existsSync(file)) return [];
  const lines = frontmatter(fs.readFileSync(file, 'utf8'));
  const out = [];
  lines.forEach((line, i) => {
    const match = line.match(/^([a-z][a-z0-9_]*):\s*(#.*)?$/);
    if (!match) return;
    const next = lines.slice(i + 1).find(l => l.trim() && !l.trim().startsWith('#'));
    if (next && /^(\s|- )/.test(next)) return;
    out.push(match[1]);
  });
  return out;
}

/** Parse connector.json at the boundary; everything past here trusts the shape. */
function parseConnector(dir, name, source) {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'connector.json'), 'utf8'));
  const list = (value, field) => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || !value.every(v => typeof v === 'string' && v)) throw Error(name + '/connector.json: "' + field + '" must be a list of strings.');
    return value;
  };
  // A journal connector writes Activity lines, not numbers: it has a tag instead of properties.
  const journal = raw.journal;
  if (journal !== undefined && (typeof journal !== 'string' || !journal.trim() || /[\][\r\n]/.test(journal))) throw Error(name + '/connector.json: "journal" must be a short tag such as "github".');
  const properties = list(raw.properties, 'properties');
  if (journal !== undefined && properties.length) throw Error(name + '/connector.json: a journal connector has no "properties".');
  if (journal === undefined && !properties.length) throw Error(name + '/connector.json: "properties" must name at least one property.');
  for (const p of properties) if (!PROPERTY.test(p)) throw Error(name + '/connector.json: bad property name ' + p + '.');
  const run = list(raw.run, 'run');
  if (!run.length) throw Error(name + '/connector.json: "run" must be a command, such as ["node", "' + name + '.cjs"].');
  const timeoutSeconds = raw.timeoutSeconds === undefined ? 20 : raw.timeoutSeconds;
  if (!(timeoutSeconds > 0)) throw Error(name + '/connector.json: "timeoutSeconds" must be a positive number.');
  return { name, dir, source, properties, ...(journal !== undefined && { journal }), run, env: list(raw.env, 'env'), bin: list(raw.bin, 'bin'), timeoutSeconds };
}

/** Local connectors shadow core ones of the same name. Broken ones are reported, not fatal. */
function discover(vault, coreDir = CORE_CONNECTORS) {
  const found = new Map();
  const problems = [];
  for (const [source, root] of [['core', coreDir], ['local', path.join(vault, 'local/connectors')]]) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const dir = path.join(root, entry.name);
      if (!entry.isDirectory() || !fs.existsSync(path.join(dir, 'connector.json'))) continue;
      try { found.set(entry.name, parseConnector(dir, entry.name, source)); }
      catch (error) { found.delete(entry.name); problems.push(error.message); }
    }
  }
  return { connectors: [...found.values()], problems };
}

/** property -> its connector, or an error when two connectors claim it. */
function providers(connectors) {
  const claims = new Map();
  for (const c of connectors) for (const p of c.properties) claims.set(p, [...(claims.get(p) || []), c]);
  const map = new Map();
  for (const [p, list] of claims) {
    map.set(p, list.length === 1 ? { connector: list[0] } : { error: list.map(c => c.name).join(' and ') + ' both provide ' + p + '.' });
  }
  return map;
}

function onPath(bin, env) {
  if (bin.includes('/')) return fs.existsSync(bin);
  return (env.PATH || '').split(path.delimiter).some(dir => dir && fs.existsSync(path.join(dir, bin)));
}

/** Why this connector cannot run here, or null. */
function blocker(c, env = process.env) {
  const missing = c.env.filter(name => !env[name]);
  if (missing.length) return 'Missing environment variable: ' + missing.join(', ');
  const absent = c.bin.filter(b => !onPath(b, env));
  if (absent.length) return 'Missing program on PATH: ' + absent.join(', ');
  return null;
}

/** stdout is a JSON object, key=value lines, or one bare number for a single-property connector. */
function parseOutput(stdout, properties) {
  const text = stdout.trim();
  let json;
  try { json = JSON.parse(text); } catch {
    const values = {};
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([a-z][a-z0-9_]*)\s*=\s*(.+?)\s*$/);
      if (match) values[match[1]] = Number(match[2]);
    }
    return values;
  }
  if (typeof json === 'number') return properties.length === 1 ? { [properties[0]]: json } : {};
  return json && typeof json === 'object' && !Array.isArray(json) ? json : {};
}

function execute(c) {
  return new Promise(resolve => {
    const [cmd, ...args] = c.run;
    // detached: its own process group, so a timeout also kills anything it started.
    const child = spawn(cmd === 'node' ? process.execPath : cmd, args, { cwd: c.dir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let stdout = '', stderr = '', settled = false;
    const done = result => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    const stop = error => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      child.stdout.destroy(); child.stderr.destroy();
      done({ error });
    };
    const timer = setTimeout(() => stop('Timed out after ' + c.timeoutSeconds + 's.'), c.timeoutSeconds * 1000);
    child.stdout.on('data', d => { stdout += d; if (stdout.length > MAX_OUTPUT) stop('Printed more than 5 MB.'); });
    child.stderr.on('data', d => { stderr += d; if (stderr.length > MAX_OUTPUT) stop('Wrote more than 5 MB to stderr.'); });
    child.on('error', error => done({ error: 'Could not start ' + cmd + ': ' + error.message }));
    child.on('close', code => {
      if (code !== 0) return done({ error: (stderr.trim().split(/\r?\n/).pop() || 'Exited with code ' + code + '.') });
      done(c.journal ? { stdout, stderr } : { values: parseOutput(stdout, c.properties), stderr });
    });
  });
}

/** What a connector wrote to stderr, passed on under its name so it reaches the schedule's log (a failed run's stderr is already its error). */
function passStderr(c, result, warn) {
  for (const line of (result.stderr || '').split(/\r?\n/)) if (line.trim()) warn(c.name + ': ' + line.trimEnd() + '\n');
}

/** Run each connector once and read the values for the given properties, in order. */
async function readAll(properties, providerMap, warn) {
  const runs = new Map();
  const out = [];
  for (const property of properties) {
    const p = providerMap.get(property);
    if (p.error) { out.push({ property, value: 'unknown', error: p.error }); continue; }
    const c = p.connector;
    if (!runs.has(c.name)) {
      const why = blocker(c);
      runs.set(c.name, why ? { error: why } : await execute(c));
      passStderr(c, runs.get(c.name), warn);
    }
    const result = runs.get(c.name);
    if (result.error) { out.push({ property, value: 'unknown', error: result.error }); continue; }
    const value = result.values[property];
    if (typeof value === 'number' && Number.isFinite(value)) out.push({ property, value });
    else {
      // A connector that exits 0 may say why a key is null on stderr: that is the reason, not "returned null".
      const reason = value == null && result.stderr && result.stderr.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean).join('; ');
      out.push({ property, value: 'unknown', error: reason || c.name + ' returned ' + JSON.stringify(value ?? null) + ' for ' + property + ', not a number.' });
    }
  }
  return out;
}

/** The raw value of a top-level frontmatter property, or undefined when it is absent. */
function getProperty(text, property) {
  const line = frontmatter(text).find(l => l.startsWith(property + ':'));
  return line === undefined ? undefined : line.slice(property.length + 1).replace(/\s+#.*$/, '').trim();
}

function setProperty(text, property, value) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const match = text.match(/^﻿?---\r?\n(?:([\s\S]*?)\r?\n)?---(?=\r?\n|$)/);
  if (!match) return '---' + eol + property + ': ' + value + eol + '---' + eol + eol + text;
  const line = property + ': ' + value;
  if (match[1] === undefined) {
    const at = match.index + match[0].indexOf('\n') + 1;
    return text.slice(0, at) + line + eol + text.slice(at);
  }
  const lines = match[1].split(/\r?\n/), at = lines.findIndex(l => l.startsWith(property + ':'));
  if (at >= 0) lines[at] = line; else lines.push(line);
  const start = match.index + match[0].indexOf(match[1]);
  return text.slice(0, start) + lines.join(eol) + text.slice(start + match[1].length);
}

/** What a new daily note for this date starts as. */
function newNote(vault, date) {
  const templateFile = path.join(vault, TEMPLATE);
  const template = fs.existsSync(templateFile) ? fs.readFileSync(templateFile, 'utf8') : '---\ntype: daily\n---\n\n# {{date:YYYY-MM-DD}}\n\n## Activity\n';
  return template.replace(/\{\{date:YYYY-MM-DD\}\}/g, date);
}

function todayNote(vault, date) {
  const file = path.join(vault, DAILY_DIR, date + '.md');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, newNote(vault, date), { flag: 'wx' });
  }
  return file;
}

/** Crash-safe: a reader sees the old note or the new one, never half of it. */
function writeNote(file, text) {
  const temp = file + '.lcars-tmp';
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, file);
}

const SECTION = /^## Activity\s*$/;

/**
 * The note with these lines added at the end of its last `## Activity` section, or null when it has none.
 * The lines go in at one offset, in the heading line's line ending; every other byte stays as it was.
 * Frontmatter and fenced code are not headings.
 */
function appendActivity(text, lines) {
  let fence = null, front = /^\uFEFF?---\r?\n/.test(text), section = null;
  for (let pos = 0, i = 0; pos < text.length; i++) {
    const nl = text.indexOf('\n', pos), next = nl < 0 ? text.length : nl + 1;
    const row = text.slice(pos, next).replace(/\r?\n$/, '').replace(/^\uFEFF/, '');
    const mark = row.match(/^ {0,3}(`{3,}|~{3,})/);
    if (front) { if (i && (row === '---' || row === '...')) front = false; }
    else if (fence) { if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && /^ {0,3}[`~]+\s*$/.test(row)) fence = null; }
    else if (mark) fence = mark[1];
    else if (SECTION.test(row)) section = { at: next, eol: nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n', open: true };
    else if (section && section.open) {
      if (/^#{1,2} /.test(row)) section.open = false;
      else if (row.trim()) section.at = next;
    }
    pos = next;
  }
  if (!section) return null;
  const body = lines.join(section.eol);
  return text.slice(0, section.at) + (text[section.at - 1] === '\n' ? body + section.eol : section.eol + body) + text.slice(section.at);
}

const UNSEEN = /[\p{Cc}\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/gu; // control, zero-width and bidi characters

/** One Activity line from one event, or {warning}. `at` must be a recent past time; text and link come from outside, so they are cleaned here. */
function journalLine(event, tag, now = new Date()) {
  if (!event || typeof event !== 'object' || typeof event.text !== 'string') return { warning: 'an event has no text' };
  const when = typeof event.at === 'string' ? new Date(event.at) : new Date(NaN);
  if (Number.isNaN(when.getTime())) return { warning: 'an event has no readable "at"' };
  if (when > now) return { warning: 'an event is in the future (' + event.at + ')' };
  if (now - when > MAX_AGE_DAYS * 864e5) return { warning: 'an event is more than ' + MAX_AGE_DAYS + ' days old (' + event.at + ')' };
  // Outside text must not become a wikilink, markdown link, tag, embed, math or HTML in Obsidian; cut by code point so an emoji is never halved.
  const text = [...event.text.replace(/\s+/g, ' ').replace(UNSEEN, '').trim()
    .replace(/\[(?=\[)/g, '[ ').replace(/\](?=\])/g, '] ').replace(/\]\(/g, '] (').replace(/</g, '&lt;')
    .replace(/%(?=%)/g, '% ').replace(/\$(?=\$)/g, '$ ').replace(/(?<![\p{L}\p{N}_])#(?=\p{L})/gu, '\\#')].slice(0, 200).join('');
  if (!text) return { warning: 'an event has no text' };
  let link = '';
  if (event.link !== undefined) {
    try { const url = new URL(event.link); if (url.protocol === 'https:') link = '[link](' + url.href.replace(/\)/g, '%29') + ')'; } catch { /* dropped below */ }
    if (link.length > MAX_LINK) link = '';
  }
  const pad = n => String(n).padStart(2, '0');
  const prefix = '- ' + pad(when.getHours()) + ':' + pad(when.getMinutes()) + ' [' + tag + '] ';
  return { date: localDate(when), at: when.getTime(), prefix, link, line: prefix + text + (link && ' ' + link), ...(event.link !== undefined && !link && { warning: 'dropped a link that is not https or is too long' }) };
}

/**
 * Run the journal connectors and add each event to the Activity section of its own day's note, once.
 * Failures follow the number connectors' rule: a warning, never a failed collect, and nothing else changes.
 */
async function journal(vault, connectors, { dryRun, write, warn, now = new Date() }) {
  const events = [];
  for (const c of connectors) {
    const why = blocker(c);
    const result = why ? { error: why } : await execute(c);
    passStderr(c, result, warn);
    if (result.error) { write('warning: journal ' + c.name + ': ' + result.error + '\n'); continue; }
    const mine = [];
    result.stdout.split(/\r?\n/).forEach((raw, i) => {
      if (!raw.trim()) return;
      let event;
      try { event = JSON.parse(raw); } catch { event = null; }
      const made = journalLine(event, c.journal, now);
      if (made.warning) write('warning: journal ' + c.name + ' line ' + (i + 1) + ': ' + made.warning + '\n');
      if (made.line) mine.push({ ...made, name: c.name });
    });
    if (mine.length > MAX_LINES) {
      write('warning: journal ' + c.name + ': kept the newest ' + MAX_LINES + ' of ' + mine.length + ' events, dropped ' + (mine.length - MAX_LINES) + '\n');
      mine.sort((a, b) => a.at - b.at).splice(0, mine.length - MAX_LINES);
    }
    events.push(...mine);
  }
  const dates = [...new Set(events.map(e => e.date))].sort();
  const added = new Map(connectors.map(c => [c.name, 0]));
  for (const date of dates) {
    const file = path.join(vault, DAILY_DIR, date + '.md');
    try {
      const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : newNote(vault, date);
      // A line is already there when it matches exactly, or, for an event with a link, starts the same way and holds the same link (a retitled PR is not a new event).
      const rows = text.split(/\r?\n/), seen = new Set(rows);
      const there = e => e.link ? rows.some(r => r.startsWith(e.prefix) && r.includes(e.link)) : seen.has(e.line);
      const fresh = events.filter(e => e.date === date).sort((a, b) => a.at - b.at).filter(e => !there(e) && rows.push(e.line) && seen.add(e.line));
      if (!fresh.length) continue;
      const next = appendActivity(text, fresh.map(e => e.line));
      if (next === null) { write('warning: ' + date + '.md has no "## Activity" heading; skipped ' + fresh.length + ' journal line(s)\n'); continue; }
      if (dryRun) for (const e of fresh) write('would add to ' + date + '.md: ' + e.line + '\n');
      else { fs.mkdirSync(path.dirname(file), { recursive: true }); writeNote(file, next); }
      for (const e of fresh) added.set(e.name, added.get(e.name) + 1);
    } catch (error) { write('warning: ' + date + '.md: ' + error.message + '\n'); } // one bad note never costs the other days their lines
  }
  for (const [name, n] of added) write('journal ' + name + ': ' + (dryRun ? 'would add ' : 'added ') + n + ' line(s)\n');
}

/**
 * @param {{vault: string, dryRun?: boolean, only?: string, coreDir?: string, write?: (s: string) => void, warn?: (s: string) => void}} options
 * @returns {Promise<Reading[]>}
 */
async function collect({ vault, dryRun = false, only, coreDir, write = s => process.stdout.write(s), warn = s => process.stderr.write(s) }) {
  const { connectors, problems } = discover(vault, coreDir);
  for (const problem of problems) write('warning: ' + problem + '\n');
  const providerMap = providers(connectors);
  const journals = connectors.filter(c => c.journal && (!only || c.name === only));
  let properties;
  if (only) {
    const c = connectors.find(x => x.name === only);
    if (!c) throw Error('No connector named ' + only + '. Connectors: ' + connectors.map(x => x.name).join(', '));
    properties = c.properties;
  } else {
    properties = trackedProperties(vault).filter(p => providerMap.has(p));
  }
  const readings = await readAll(properties, providerMap, warn);
  const date = localDate();
  if (!dryRun && readings.length) {
    const file = todayNote(vault, date);
    let text = fs.readFileSync(file, 'utf8');
    for (const r of readings) {
      // A failed rerun never erases a reading that already worked, or a value the owner typed.
      const current = getProperty(text, r.property);
      if (r.value === 'unknown' && current && current !== 'unknown') { r.kept = current; continue; }
      text = setProperty(text, r.property, r.value);
    }
    writeNote(file, text);
  }
  for (const r of readings) write(r.property + ': ' + r.value + (r.error ? '  (' + r.error + (r.kept ? '; kept ' + r.kept : '') + ')' : '') + '\n');
  await journal(vault, journals, { dryRun, write, warn });
  if (!readings.length) { if (!journals.length) write('No tracked property has a connector. Add one to local/connectors/ and its property to ' + TEMPLATE + '.\n'); }
  else if (dryRun) write('Dry run: nothing written.\n');
  else write('Wrote ' + readings.length + ' value(s) to ' + date + '.md\n');
  return readings;
}

module.exports = { journalLine, appendActivity, collect, discover, providers, trackedProperties, parseOutput, blocker, setProperty, getProperty, localDate, DAILY_DIR, TEMPLATE };

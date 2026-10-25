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

/** @typedef {{name: string, dir: string, source: 'local'|'core', properties: string[], run: string[], env: string[], bin: string[], timeoutSeconds: number}} Connector */
/** @typedef {{property: string, value: number|'unknown', error?: string}} Reading */

function localDate(now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
}

function frontmatter(text) {
  const match = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  return match ? match[1].split(/\r?\n/) : [];
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
    const match = line.match(/^([a-z][a-z0-9_]*):\s*$/);
    if (!match) return;
    const next = lines.slice(i + 1).find(l => l.trim() && !l.trim().startsWith('#'));
    if (next && /^\s/.test(next)) return;
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
  const properties = list(raw.properties, 'properties');
  if (!properties.length) throw Error(name + '/connector.json: "properties" must name at least one property.');
  for (const p of properties) if (!PROPERTY.test(p)) throw Error(name + '/connector.json: bad property name ' + p + '.');
  const run = list(raw.run, 'run');
  if (!run.length) throw Error(name + '/connector.json: "run" must be a command, such as ["node", "' + name + '.cjs"].');
  const timeoutSeconds = raw.timeoutSeconds === undefined ? 20 : raw.timeoutSeconds;
  if (!(timeoutSeconds > 0)) throw Error(name + '/connector.json: "timeoutSeconds" must be a positive number.');
  return { name, dir, source, properties, run, env: list(raw.env, 'env'), bin: list(raw.bin, 'bin'), timeoutSeconds };
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

function onPath(bin) {
  if (bin.includes('/')) return fs.existsSync(bin);
  return (process.env.PATH || '').split(path.delimiter).some(dir => dir && fs.existsSync(path.join(dir, bin)));
}

/** Why this connector cannot run here, or null. */
function blocker(c) {
  const missing = c.env.filter(name => !process.env[name]);
  if (missing.length) return 'Missing environment variable: ' + missing.join(', ');
  const absent = c.bin.filter(b => !onPath(b));
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
    const child = spawn(cmd === 'node' ? process.execPath : cmd, args, { cwd: c.dir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', settled = false;
    const done = result => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    const timer = setTimeout(() => { child.kill('SIGKILL'); done({ error: 'Timed out after ' + c.timeoutSeconds + 's.' }); }, c.timeoutSeconds * 1000);
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', error => done({ error: 'Could not start ' + cmd + ': ' + error.message }));
    child.on('close', code => {
      if (code !== 0) return done({ error: (stderr.trim().split(/\r?\n/).pop() || 'Exited with code ' + code + '.') });
      done({ values: parseOutput(stdout, c.properties) });
    });
  });
}

/** Run each connector once and read the values for the given properties, in order. */
async function readAll(properties, providerMap) {
  const runs = new Map();
  const out = [];
  for (const property of properties) {
    const p = providerMap.get(property);
    if (p.error) { out.push({ property, value: 'unknown', error: p.error }); continue; }
    const c = p.connector;
    if (!runs.has(c.name)) {
      const why = blocker(c);
      runs.set(c.name, why ? { error: why } : await execute(c));
    }
    const result = runs.get(c.name);
    if (result.error) { out.push({ property, value: 'unknown', error: result.error }); continue; }
    const value = result.values[property];
    if (typeof value === 'number' && Number.isFinite(value)) out.push({ property, value });
    else out.push({ property, value: 'unknown', error: c.name + ' returned ' + JSON.stringify(value ?? null) + ' for ' + property + ', not a number.' });
  }
  return out;
}

function setProperty(text, property, value) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const match = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return '---' + eol + property + ': ' + value + eol + '---' + eol + eol + text;
  const lines = match[1].split(/\r?\n/), at = lines.findIndex(line => line.startsWith(property + ':'));
  if (at >= 0) lines[at] = property + ': ' + value; else lines.push(property + ': ' + value);
  const start = match.index + match[0].indexOf(match[1]);
  return text.slice(0, start) + lines.join(eol) + text.slice(start + match[1].length);
}

function todayNote(vault, date) {
  const file = path.join(vault, DAILY_DIR, date + '.md');
  if (!fs.existsSync(file)) {
    const templateFile = path.join(vault, TEMPLATE);
    const template = fs.existsSync(templateFile) ? fs.readFileSync(templateFile, 'utf8') : '---\ntype: daily\n---\n\n# {{date:YYYY-MM-DD}}\n\n## Activity\n';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, template.replace(/\{\{date:YYYY-MM-DD\}\}/g, date), { flag: 'wx' });
  }
  return file;
}

/**
 * @param {{vault: string, dryRun?: boolean, only?: string, coreDir?: string, write?: (s: string) => void}} options
 * @returns {Promise<Reading[]>}
 */
async function collect({ vault, dryRun = false, only, coreDir, write = s => process.stdout.write(s) }) {
  const { connectors, problems } = discover(vault, coreDir);
  for (const problem of problems) write('warning: ' + problem + '\n');
  const providerMap = providers(connectors);
  let properties;
  if (only) {
    const c = connectors.find(x => x.name === only);
    if (!c) throw Error('No connector named ' + only + '. Connectors: ' + connectors.map(x => x.name).join(', '));
    properties = c.properties;
  } else {
    properties = trackedProperties(vault).filter(p => providerMap.has(p));
  }
  const readings = await readAll(properties, providerMap);
  const date = localDate();
  if (!dryRun && readings.length) {
    const file = todayNote(vault, date);
    let text = fs.readFileSync(file, 'utf8');
    for (const r of readings) text = setProperty(text, r.property, r.value);
    fs.writeFileSync(file, text);
  }
  for (const r of readings) write(r.property + ': ' + r.value + (r.error ? '  (' + r.error + ')' : '') + '\n');
  if (!readings.length) write('No tracked property has a connector. Add one to local/connectors/ and its property to ' + TEMPLATE + '.\n');
  else if (dryRun) write('Dry run: nothing written.\n');
  else write('Wrote ' + readings.length + ' value(s) to ' + date + '.md\n');
  return readings;
}

module.exports = { collect, discover, providers, trackedProperties, parseOutput, blocker, setProperty, localDate, TEMPLATE };

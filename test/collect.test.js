'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collect, trackedProperties, parseOutput, localDate } = require('../lib/collect');

function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcars-collect-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), typeof text === 'string' ? text : JSON.stringify(text));
  }
  return dir;
}
const connector = (properties, script, extra = {}) => ({ 'connector.json': { properties, run: ['node', 'run.cjs'], ...extra }, 'run.cjs': script });
const prefixed = (prefix, files) => Object.fromEntries(Object.entries(files).map(([k, v]) => [prefix + k, v]));

const TEMPLATE = `---
type: daily
date: "{{date:YYYY-MM-DD}}"
tags:
  - daily
# Tracked numbers go below.
beta_count:
typed_by_hand:
alpha_total:
---

# {{date:YYYY-MM-DD}}

## Activity
`;

async function run(vault, coreDir, opts = {}) {
  let out = '';
  const readings = await collect({ vault, coreDir, write: s => { out += s; }, ...opts });
  return { readings, out };
}

test('tracked properties are the empty frontmatter keys, in template order', () => {
  const vault = tree({ '00 Human/80 Templates/Daily.md': TEMPLATE });
  assert.deepEqual(trackedProperties(vault), ['beta_count', 'typed_by_hand', 'alpha_total']);
});

test('dry run prints readings in template order and writes nothing', async () => {
  const core = tree(prefixed('beta/', connector(['beta_count'], 'console.log("beta_count=7")')));
  const vault = tree({
    '00 Human/80 Templates/Daily.md': TEMPLATE,
    ...prefixed('local/connectors/alpha/', connector(['alpha_total'], 'console.log(3.86)')),
  });
  const { out } = await run(vault, core, { dryRun: true });
  assert.equal(out, 'beta_count: 7\nalpha_total: 3.86\nDry run: nothing written.\n');
  assert.equal(fs.existsSync(path.join(vault, '00 Human/10 Daily Notes')), false);
});

test('collect writes today\'s note from the template, and failures are unknown, never 0', async () => {
  const core = tree({});
  const vault = tree({
    '00 Human/80 Templates/Daily.md': TEMPLATE,
    ...prefixed('local/connectors/beta/', connector(['beta_count'], 'console.error("Jira answered 401."); process.exit(1)')),
    ...prefixed('local/connectors/alpha/', connector(['alpha_total'], '', { env: ['LCARS_TEST_NOT_SET'] })),
  });
  const { out } = await run(vault, core);
  assert.match(out, /^beta_count: unknown {2}\(Jira answered 401\.\)$/m);
  assert.match(out, /^alpha_total: unknown {2}\(Missing environment variable: LCARS_TEST_NOT_SET\)$/m);
  const note = fs.readFileSync(path.join(vault, '00 Human/10 Daily Notes', localDate() + '.md'), 'utf8');
  assert.match(note, /^beta_count: unknown$/m);
  assert.match(note, /^alpha_total: unknown$/m);
  assert.match(note, /^typed_by_hand:$/m);
  assert.match(note, new RegExp('^# ' + localDate() + '$', 'm'));
});

test('a local connector shadows a core one; two names claiming one property is an error', async () => {
  const core = tree({
    ...prefixed('alpha/', connector(['alpha_total'], 'console.log(1)')),
    ...prefixed('other/', connector(['beta_count'], 'console.log(1)')),
  });
  const vault = tree({
    '00 Human/80 Templates/Daily.md': TEMPLATE,
    ...prefixed('local/connectors/alpha/', connector(['alpha_total'], 'console.log(2)')),
    ...prefixed('local/connectors/dupe/', connector(['beta_count'], 'console.log(3)')),
  });
  const { out } = await run(vault, core, { dryRun: true });
  assert.match(out, /^alpha_total: 2$/m);
  assert.match(out, /^beta_count: unknown {2}\(other and dupe both provide beta_count\.\)$/m);
});

test('--only runs an untracked connector; timeouts and missing programs are unknown', async () => {
  const core = tree({});
  const vault = tree({
    '00 Human/80 Templates/Daily.md': TEMPLATE,
    ...prefixed('local/connectors/slow/', connector(['slow_value'], 'setTimeout(() => console.log(1), 5000)', { timeoutSeconds: 0.3 })),
    ...prefixed('local/connectors/needs/', connector(['needs_value'], 'console.log(1)', { bin: ['lcars-test-no-such-program'] })),
  });
  assert.match((await run(vault, core, { dryRun: true, only: 'slow' })).out, /^slow_value: unknown {2}\(Timed out after 0\.3s\.\)$/m);
  assert.match((await run(vault, core, { dryRun: true, only: 'needs' })).out, /Missing program on PATH: lcars-test-no-such-program/);
  assert.match((await run(vault, core, { dryRun: true })).out, /No tracked property has a connector/);
});

test('output formats: JSON object, key=value lines, bare number for one property only', () => {
  assert.deepEqual(parseOutput('{"a": 1, "b": 2}', ['a', 'b']), { a: 1, b: 2 });
  assert.deepEqual(parseOutput('a=1\nb = 2.5\n', ['a', 'b']), { a: 1, b: 2.5 });
  assert.deepEqual(parseOutput('42\n', ['a']), { a: 42 });
  assert.deepEqual(parseOutput('42', ['a', 'b']), {});
  assert.deepEqual(parseOutput('[1]', ['a']), {});
});

test('a non-number value is unknown with the reason', async () => {
  const vault = tree({
    '00 Human/80 Templates/Daily.md': TEMPLATE,
    ...prefixed('local/connectors/alpha/', connector(['alpha_total'], 'console.log(JSON.stringify({alpha_total: "lots"}))')),
  });
  const { out } = await run(vault, tree({}), { dryRun: true });
  assert.match(out, /^alpha_total: unknown {2}\(alpha returned "lots" for alpha_total, not a number\.\)$/m);
});

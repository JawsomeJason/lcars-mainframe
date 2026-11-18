'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collect, discover, journalLine, appendActivity, localDate, DAILY_DIR } = require('../lib/collect');

const TEMPLATE = '---\ntype: daily\ntotal_count:\n---\n\n# {{date:YYYY-MM-DD}}\n\n## Focus\n\nmine\n\n## Activity\n';
const NOW = new Date(2026, 10, 18, 12, 0);
const at = (...args) => new Date(...args).toISOString();

function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcars-journal-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), typeof text === 'string' ? text : JSON.stringify(text));
  }
  return dir;
}
/** A journal connector that prints these events, one JSON line each (a string is printed as it is). */
const journal = (name, tag, events, extra = {}) => ({
  ['local/connectors/' + name + '/connector.json']: { journal: tag, run: ['node', 'run.cjs'], ...extra },
  ['local/connectors/' + name + '/run.cjs']: events.map(e => 'console.log(' + JSON.stringify(typeof e === 'string' ? e : JSON.stringify(e)) + ');').join('\n'),
});
const noteFile = (vault, date) => path.join(vault, DAILY_DIR, date + '.md');
async function run(vault, opts = {}) {
  let out = '';
  const readings = await collect({ vault, coreDir: tree({}), write: s => { out += s; }, ...opts });
  return { readings, out };
}
const today = new Date();
const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
const when = (d, h, m) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).toISOString();

test('a line is built from local time, cleaned, and never a wikilink or a non-https link', () => {
  const ok = journalLine({ at: at(2026, 10, 18, 9, 5), text: '  Opened   PR:\n [[Secret]] done ](x) ', link: 'https://github.com/a/b/pull/1' }, 'github', NOW);
  assert.equal(ok.line, '- 09:05 [github] Opened PR: [ [Secret] ] done ] (x) [link](https://github.com/a/b/pull/1)');
  assert.equal(ok.date, '2026-11-18');
  assert.equal(journalLine({ at: at(2026, 10, 18, 9, 5), text: 'x'.repeat(500) }, 't', NOW).line.length, '- 09:05 [t] '.length + 200);
  assert.equal(journalLine({ at: at(2026, 10, 18, 9, 5), text: 'No link' }, 'jira', NOW).line, '- 09:05 [jira] No link');
  const http = journalLine({ at: at(2026, 10, 18, 9, 5), text: 'x', link: 'http://example.com' }, 't', NOW);
  assert.equal(http.line, '- 09:05 [t] x');
  assert.match(http.warning, /not https/);
  assert.match(journalLine({ at: at(2026, 10, 18, 9, 5), text: 'x', link: 'https://e.com/a)b c' }, 't', NOW).line, /\(https:\/\/e\.com\/a%29b%20c\)$/);
  // Outside text must not turn into a wikilink, tag, embed, math or HTML; an emoji is never cut in half.
  const clean = text => journalLine({ at: at(2026, 10, 18, 9, 5), text }, 't', NOW).line.slice('- 09:05 [t] '.length);
  assert.equal(clean('[[[x]]] a%%b $$c <b> #tag (#tag) PR #12 repo#n C#'), '[ [ [x] ] ] a% %b $ $c &lt;b> \\#tag (\\#tag) PR #12 repo#n C#');
  assert.equal(clean('a\u200Bb\u202Ec\u0007d\u2066'), 'abcd');
  assert.equal(clean('😀'.repeat(300)), '😀'.repeat(200));
  const tooLong = journalLine({ at: at(2026, 10, 18, 9, 5), text: 'x', link: 'https://e.com/' + 'a'.repeat(2000) }, 't', NOW);
  assert.equal(tooLong.line, '- 09:05 [t] x');
  assert.match(tooLong.warning, /dropped a link/);
  assert.match(journalLine({ at: at(2026, 9, 17, 9, 5), text: 'x' }, 't', NOW).warning, /more than 31 days old/);
  assert.ok(journalLine({ at: at(2026, 9, 18, 13, 0), text: 'x' }, 't', NOW).line);
  assert.match(journalLine({ at: 'soon', text: 'x' }, 't', NOW).warning, /readable "at"/);
  assert.match(journalLine({ at: at(2026, 10, 19), text: 'x' }, 't', NOW).warning, /future/);
  assert.match(journalLine({ at: at(2026, 10, 18, 9), text: '  ' }, 't', NOW).warning, /no text/);
});

test('lines go to the end of ## Activity only, keeping every other line and the line endings', () => {
  const note = '# d\n\n## Activity\n\n- 01:00 [x] old\n\n## Notes\nmine\n';
  assert.equal(appendActivity(note, ['- 02:00 [y] new']), '# d\n\n## Activity\n\n- 01:00 [x] old\n- 02:00 [y] new\n\n## Notes\nmine\n');
  assert.equal(appendActivity('## Activity', ['- a']), '## Activity\n- a');
  assert.equal(appendActivity('## Activity\r\n- 1\r\n', ['- 2']), '## Activity\r\n- 1\r\n- 2\r\n');
  assert.equal(appendActivity('# d\n## Notes\n', ['- a']), null);
});

test('appendActivity touches no byte the owner wrote: mixed endings, frontmatter, fences, two headings', () => {
  const insert = (text, at, lines) => text.slice(0, at) + lines + text.slice(at);
  // The new lines take the heading's ending and go in at one offset; the rest of the note is the same bytes.
  const mixed = '---\r\ntitle: ## Activity\r\n---\r\nowner\n```\n# not a heading\n## Activity\n```\n## Activity\r\n- 1\n\r\n\r\n## Notes\nx\r\n';
  const at1 = mixed.indexOf('- 1\n') + 4;
  assert.equal(appendActivity(mixed, ['- a', '- b']), insert(mixed, at1, '- a\r\n- b\r\n'));
  // The last real heading wins; an LF heading in a CRLF note gets LF lines; a note that ends without a newline stays that way.
  const two = '## Activity\n- old\n## Notes\n~~~\n## Activity\n~~~\n## Activity\n- x\r\n- y';
  assert.equal(appendActivity(two, ['- a']), two + '\n- a');
  assert.equal(appendActivity('## Activity\r\n', ['- a']), '## Activity\r\n- a\r\n');
  assert.equal(appendActivity('## Activity', ['- a']), '## Activity\n- a');
  assert.equal(appendActivity('---\n## Activity\n---\n```\n## Activity\n```\n', ['- a']), null);
});

test('each event lands in the note of its own local day, in time order, and a missing note is made from the template', async () => {
  const vault = tree({
    '00 Human/80 Templates/Daily.md': TEMPLATE,
    [DAILY_DIR + '/' + localDate(yesterday) + '.md']: '# y\n\nmine\n\n## Activity\n- 08:00 [claude] earlier\n\n## Notes\nowner text\n',
    ...journal('j', 'github', [
      { at: when(yesterday, 15, 30), text: 'Late', link: 'https://github.com/a/b/pull/2' },
      { at: when(yesterday, 9, 10), text: 'Early' },
      { at: when(today, 0, 1), text: 'Today' },
    ]),
  });
  const { out } = await run(vault);
  assert.match(out, /journal j: added 3 line\(s\)/);
  assert.equal(fs.readFileSync(noteFile(vault, localDate(yesterday)), 'utf8'),
    '# y\n\nmine\n\n## Activity\n- 08:00 [claude] earlier\n- 09:10 [github] Early\n- 15:30 [github] Late [link](https://github.com/a/b/pull/2)\n\n## Notes\nowner text\n');
  const made = fs.readFileSync(noteFile(vault, localDate(today)), 'utf8');
  assert.ok(made.startsWith('---\ntype: daily'));
  assert.ok(made.endsWith('## Activity\n- 00:01 [github] Today\n'));
});

test('running twice adds nothing the second time', async () => {
  const vault = tree({ '00 Human/80 Templates/Daily.md': TEMPLATE, ...journal('j', 'jira', [{ at: when(yesterday, 10, 0), text: 'Moved A-1' }, { at: when(yesterday, 10, 0), text: 'Moved A-1' }]) });
  const first = await run(vault);
  assert.match(first.out, /added 1 line\(s\)/);
  const before = fs.readFileSync(noteFile(vault, localDate(yesterday)), 'utf8');
  const second = await run(vault);
  assert.match(second.out, /added 0 line\(s\)/);
  assert.equal(fs.readFileSync(noteFile(vault, localDate(yesterday)), 'utf8'), before);
});

test('a note without an Activity heading is skipped with a warning and left as it was', async () => {
  const file = DAILY_DIR + '/' + localDate(yesterday) + '.md';
  const vault = tree({ '00 Human/80 Templates/Daily.md': TEMPLATE, [file]: '# y\nmine\n', ...journal('j', 'g', [{ at: when(yesterday, 10, 0), text: 'x' }]) });
  const { out } = await run(vault);
  assert.match(out, /warning: .*\.md has no "## Activity" heading; skipped 1 journal line\(s\)/);
  assert.equal(fs.readFileSync(path.join(vault, file), 'utf8'), '# y\nmine\n');
});

test('a failing, slow or garbled journal connector changes no number and stops no other journal, and collect still resolves', async () => {
  const vault = tree({
    '00 Human/80 Templates/Daily.md': TEMPLATE,
    'local/connectors/n/connector.json': { properties: ['total_count'], run: ['node', 'run.cjs'] },
    'local/connectors/n/run.cjs': 'console.log(42)',
    ...journal('bad', 'bad', [], { run: ['node', 'run.cjs'] }),
    'local/connectors/bad/run.cjs': 'console.error("API said 401"); process.exit(1)',
    ...journal('garbled', 'garbled', ['not json', '{"text":"no time"}', JSON.stringify({ at: when(today, 23, 59), text: 'later' }).replace(/"later"/, '"never"'), JSON.stringify({ at: new Date(Date.now() + 864e5).toISOString(), text: 'future' })]),
    ...journal('envy', 'envy', [], { env: ['LCARS_TEST_NOT_SET'] }),
    ...journal('good', 'good', [{ at: when(yesterday, 11, 0), text: 'fine' }]),
  });
  const { out, readings } = await run(vault);
  assert.deepEqual(readings.map(r => [r.property, r.value]), [['total_count', 42]]);
  assert.match(out, /warning: journal bad: API said 401/);
  assert.match(out, /warning: journal envy: Missing environment variable: LCARS_TEST_NOT_SET/);
  assert.match(out, /warning: journal garbled line 1: an event has no text/);
  assert.match(out, /warning: journal garbled line 2: an event has no readable "at"/);
  assert.match(out, /journal good: added 1 line\(s\)/);
  assert.match(fs.readFileSync(noteFile(vault, localDate(today)), 'utf8'), /^total_count: 42$/m);
  assert.match(fs.readFileSync(noteFile(vault, localDate(yesterday)), 'utf8'), /- 11:00 \[good\] fine\n$/);
});

test('dry run prints each line and its note, and writes nothing; --only runs just that journal connector', async () => {
  const vault = tree({
    '00 Human/80 Templates/Daily.md': TEMPLATE,
    'local/connectors/n/connector.json': { properties: ['total_count'], run: ['node', 'run.cjs'] },
    'local/connectors/n/run.cjs': 'console.log(42)',
    ...journal('a', 'a', [{ at: when(yesterday, 10, 0), text: 'one' }]),
    ...journal('b', 'b', [{ at: when(yesterday, 11, 0), text: 'two' }]),
  });
  const dry = await run(vault, { dryRun: true });
  assert.match(dry.out, new RegExp('would add to ' + localDate(yesterday) + '\\.md: - 10:00 \\[a\\] one\\n'));
  assert.match(dry.out, /^total_count: 42$/m);
  assert.equal(fs.existsSync(path.join(vault, DAILY_DIR)), false);
  const only = await run(vault, { only: 'b', dryRun: true });
  assert.equal(only.out, 'would add to ' + localDate(yesterday) + '.md: - 11:00 [b] two\njournal b: would add 1 line(s)\n');
});

test('a journal connector with properties, or an empty tag, is reported as a problem', () => {
  const vault = tree({ ...journal('p', 'x', [], { properties: ['a_b'] }), ...journal('t', '', []) });
  const { connectors, problems } = discover(vault, tree({}));
  assert.deepEqual(connectors, []);
  assert.equal(problems.length, 2);
  assert.match(problems.join('\n'), /no "properties"/);
  assert.match(problems.join('\n'), /short tag/);
});

test('an event with a link is not added again when its title changed; one without a link is matched by the whole line', async () => {
  const link = 'https://github.com/a/b/pull/7';
  const vault = tree({ '00 Human/80 Templates/Daily.md': TEMPLATE, ...journal('j', 'github', [{ at: when(yesterday, 10, 0), text: 'Opened PR: first title', link }, { at: when(yesterday, 10, 5), text: 'Meeting: standup' }]) });
  await run(vault);
  fs.writeFileSync(path.join(vault, 'local/connectors/j/run.cjs'), 'console.log(' + JSON.stringify(JSON.stringify({ at: when(yesterday, 10, 0), text: 'Opened PR: retitled', link })) + ');\nconsole.log(' + JSON.stringify(JSON.stringify({ at: when(yesterday, 10, 5), text: 'Meeting: renamed' })) + ');');
  const { out } = await run(vault);
  assert.match(out, /added 1 line\(s\)/); // the renamed meeting has no link to match
  const lines = fs.readFileSync(noteFile(vault, localDate(yesterday)), 'utf8').split('\n').filter(l => l.includes('[github]'));
  assert.equal(lines.filter(l => l.includes('Opened PR')).length, 1);
  assert.equal(lines.length, 3);
});

test('a connector adds at most 200 lines per run, keeping the newest, and says how many it dropped; one unreadable note costs only its own day', async () => {
  const many = Array.from({ length: 250 }, (_, i) => ({ at: new Date(today.getTime() - (i + 1) * 60000 - 864e5 * 2).toISOString(), text: 'event ' + i }));
  const vault = tree({ '00 Human/80 Templates/Daily.md': TEMPLATE, ...journal('j', 'x', many) });
  fs.mkdirSync(noteFile(vault, localDate(new Date(today.getTime() - 864e5 * 2 - 60000 * 250))), { recursive: true }); // a folder where a note should be
  const { out } = await run(vault);
  assert.match(out, /warning: journal j: kept the newest 200 of 250 events, dropped 50/);
  assert.match(out, /warning: .*\.md: EISDIR/);
  assert.match(out, /journal j: added \d+ line\(s\)/);
});

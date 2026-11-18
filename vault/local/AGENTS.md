# local: the owner's own machinery

Everything in this folder belongs to the owner. `lcars upgrade` never changes anything here except this file.

| Folder | What goes here |
|---|---|
| `connectors/` | One folder per connector: a program that reads numbers for the daily note. |
| `workflows/` | The owner's own workflows, shaped like `Machine/Workflows/<name>/`. One with the same name as a core workflow replaces it. |

## Connectors

A connector fills one or more daily-note properties. **A program does this, not an AI**, so the same number is read the same way every day and never passes through a chat.

```
local/connectors/<name>/connector.json
local/connectors/<name>/<program>
```

`connector.json`:

```json
{
  "description": "One line: what it reads and from where.",
  "properties": ["youtube_subscribers"],
  "run": ["node", "youtube.cjs"],
  "env": ["YOUTUBE_API_KEY", "YOUTUBE_CHANNEL_ID"],
  "bin": [],
  "timeoutSeconds": 20
}
```

- `properties`: the snake_case properties it fills. Required.
- `run`: the command, as a list. It runs in the connector's folder, with no shell. `node` means the Node that runs lcars. Required.
- `env`: environment variables it needs. If one is unset, it does not run and its properties are written as `unknown`, naming the variable.
- `bin`: programs it needs on `PATH`, with the same rule.

The program prints its numbers to stdout and exits 0: a JSON object (`{"youtube_subscribers": 1234}`), `key=value` lines, or one bare number when it fills one property. To fail, print the reason to stderr and exit non-zero.

A connector runs when one of its properties is in the frontmatter of `00 Human/80 Templates/Daily.md`, left empty. Readings are written in the template's order.

If the program exits 0 but writes to stderr, `lcars collect` passes that text on as `<name>: <text>`, so it reaches the schedule's log. When a key came back null, that text is the reason shown beside `unknown`.

### Journal connectors

A journal connector writes what the owner did into the daily notes' `## Activity` log instead of a number. Put `"journal": "<tag>"` in `connector.json` (for example `"journal": "github"`) and leave out `properties`; `run`, `env`, `bin` and `timeoutSeconds` work as above.

The program prints JSON Lines on stdout, one event per line, and exits non-zero with a reason on stderr to fail:

```
{"at": "2026-11-18T14:30:00-05:00", "text": "Opened PR: Fix login (app#12)", "link": "https://github.com/acme/app/pull/12"}
```

- `at`: when it happened, ISO 8601. Required. An unreadable, future or more than 31 days old time skips the event with a warning.
- `text`: what happened. Required. Whitespace is collapsed, control, zero-width and bidi characters are removed, it is cut at 200 characters (by character, so an emoji stays whole), and it is made safe in Obsidian: runs of `[`/`]`, `](`, `<`, `%%`, `$$` and a word-leading `#tag` are broken or escaped so outside text cannot make a wikilink, link, tag, math or HTML.
- `link`: optional, `https://` only, at most 2,000 characters; otherwise it is dropped with a warning.

`lcars collect` runs journal connectors after the numbers and adds `- HH:MM [<tag>] <text> [link](<url>)`, in the machine's local time, to the end of `## Activity` in the note of the event's local date. That may be a past day, and a missing note is made from the template. A note with no `## Activity` heading is skipped with a warning. A line is skipped when the note already has it, or, for an event with a link, when a line there starts with the same `- HH:MM [tag] ` and holds the same `[link](url)`, so a retitled PR is not added twice. Running twice adds nothing; look back a few days and a missed run catches up. Lines go in at the end of the last `## Activity` heading (ignoring frontmatter and code fences) in that heading's line ending, and no other byte of the note changes. At most 200 lines per connector per run (the newest). A failed journal connector, or one note that cannot be read or written, is a warning and changes nothing else.

Known limits: lines use the machine's time zone, so moving zones can repeat a line; an event with no link that is renamed at the source repeats; a line the owner deleted comes back while its event is still inside the connector's look-back. `lcars status` and `lcars doctor` list them, and `lcars collect --only <name> --dry-run` shows each line and its note without writing.

Rules for journal connectors: one event is one fact from the source, never a guess; the tag is the connector's, so the owner can tell its lines from an agent's.

```
lcars collect --only <name> --dry-run   # test one connector, even before its property is in the template
lcars collect --dry-run                 # every tracked property, nothing written
lcars status                            # which properties have a working connector
lcars doctor                            # also checks the schedule, the last run and frozen numbers
```

Rules:

1. Return real numbers or fail. Never print a guess, a default or a carried-forward value. A failure is written as `unknown`, never `0`.
2. Prefer the platform's official API. A scraper is a last resort and must say so in its `description`.
3. Keys come from environment variables. Never write a key into this folder.
4. A folder here with the same name as a core connector replaces it. The core ships a working example, `youtube`, in the lcars package's `connectors/` folder.

Record failures that repeat, and how they were fixed, in `connectors/FINDINGS.md`.

> **Owner overrides:** if an `AGENTS.local.md` sits beside this file, read it next. Where the two disagree, `AGENTS.local.md` wins.

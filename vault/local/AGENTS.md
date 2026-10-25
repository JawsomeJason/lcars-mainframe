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

```
lcars collect --only <name> --dry-run   # test one connector, even before its property is in the template
lcars collect --dry-run                 # every tracked property, nothing written
lcars status                            # which properties have a working connector
```

Rules:

1. Return real numbers or fail. Never print a guess, a default or a carried-forward value. A failure is written as `unknown`, never `0`.
2. Prefer the platform's official API. A scraper is a last resort and must say so in its `description`.
3. Keys come from environment variables. Never write a key into this folder.
4. A folder here with the same name as a core connector replaces it. The core ships a working example, `youtube`, in the lcars package's `connectors/` folder.

Record failures that repeat, and how they were fixed, in `connectors/FINDINGS.md`.

> **Owner overrides:** if an `AGENTS.local.md` sits beside this file, read it next. Where the two disagree, `AGENTS.local.md` wins.

# onboarding

Shapes a fresh workspace around what the owner wants to track. It sets up **structure**: the daily note's properties, the content tracker's fields, and the connectors that fill the numbers. It does not write the owner's notes, context, or ideas for them.

## Read first

1. The root `AGENTS.md`.
2. `FINDINGS.md` in this folder.
3. `SKILL.md` in this folder.

## Pull in only

- `00 Human/80 Templates/Daily.md` and `00 Human/80 Templates/Content Idea.md` (you will edit these).
- `00 Human/10 Daily Notes/Daily Notes.base` and `00 Human/90 Content/Content.base` (you will add columns).
- `local/AGENTS.md` (how to write a connector) and the connectors already in `local/connectors/`.

## You may change

- Template **properties** and the `.base` column lists, after the owner approves the list.
- New connector folders in `local/connectors/`.

## Never

- Fill in a number, a context note, or an idea on the owner's behalf. Empty is fine.
- Ask for an API key or password in chat, or write one into a file. Tell the owner which environment variable to set.
- Remove a property that already has values in existing notes without asking.

## After the run

Append to today's daily note `## Activity`. Add a `FINDINGS.md` entry: what was set up, which questions confused the owner, what to ask differently next time.

> **Owner overrides:** if an `AGENTS.local.md` sits beside this file, read it next. Where the two disagree, `AGENTS.local.md` wins.

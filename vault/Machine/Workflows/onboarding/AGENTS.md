# onboarding

Shapes a fresh workspace around what the owner wants to track. It sets up **structure**: the daily note's properties, the content tracker's fields, and the collector list. It does not write the owner's notes, context, or ideas for them.

## Read first

1. The root `AGENTS.md`.
2. `FINDINGS.md` in this folder.
3. `SKILL.md` in this folder.

## Pull in only

- `00 Human/80 Templates/Daily.md` and `00 Human/80 Templates/Content Idea.md` (you will edit these).
- `00 Human/10 Daily Notes/Daily Notes.base` and `00 Human/90 Content/Content.base` (you will add columns).
- `Machine/Scripts/collectors/AGENTS.md` and `collectors.json`.

## You may change

- Template **properties** and the `.base` column lists, after the owner approves the list.
- `Machine/Scripts/collectors/collectors.json`, and new collector scripts in that folder.

## Never

- Fill in a number, a context note, or an idea on the owner's behalf. Empty is fine.
- Ask for an API key or password in chat, or write one into a file. Tell the owner which environment variable to set.
- Remove a property that already has values in existing notes without asking.

## After the run

Append to today's daily note `## Activity`. Add a `FINDINGS.md` entry: what was set up, which questions confused the owner, what to ask differently next time.

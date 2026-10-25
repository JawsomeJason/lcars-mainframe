# AGENTS.md: read this first

This folder is a workspace made of plain Markdown files. The owner reads and writes it in Obsidian. HQ, the front end, reads the same files. Any AI tool can work here (Claude Code, Codex, Pi, or whatever comes next) as long as it follows these rules.

This file is the map and the ground rules. Every folder below has its own `AGENTS.md` with the rules for that folder. Read the one for the folder you are about to work in. Do not read the whole workspace to "get context"; pull only what the job needs.

## The one hard line: Human vs Machine

| Side | What lives there | What you may do |
|---|---|---|
| `00 Human/` | The owner's own thinking: daily notes, tasks, projects, people, context, content. | Organize, move, link, and fill **properties**. Append to the daily note's `## Activity` log. **Never write your own ideas, summaries, or opinions here.** |
| `Machine/` | Your side: workflows, scripts, logs, research, drafts, outputs. | Write and edit freely. Make a mess if the job needs it. |

If you are unsure which side something belongs on, it goes in `Machine/`. The owner can promote it to `00 Human/` themselves.

Do not summarize or "clean up" the owner's words. You never know if a summary kept their intent or only what you think their intent was.

## Map

| Folder | Purpose |
|---|---|
| `00 Human/10 Daily Notes/` | One note per day (`YYYY-MM-DD.md`). The properties at the top are the day's numbers. `## Activity` is the log. |
| `00 Human/20 Tasks/` | One task per file. |
| `00 Human/30 Projects/` | One note per project. |
| `00 Human/40 Resources/` | Reference material the owner chose to keep. |
| `00 Human/50 People/` | One note per person. |
| `00 Human/70 Context/` | Durable context: business, audience, voice. Read it before writing anything in the owner's voice. |
| `00 Human/80 Templates/` | The shape of every note type. The properties here are the schema. |
| `00 Human/90 Content/` | The content tracker. One note per piece of content. |
| `Machine/Workflows/` | Repeatable jobs. **One folder per workflow**, each with `SKILL.md`, `AGENTS.md`, and `FINDINGS.md`. |
| `local/` | The owner's own machinery: connectors in `local/connectors/`, workflows in `local/workflows/`. `lcars upgrade` never touches it. |
| `Machine/Outputs/` | Finished deliverables and drafts produced by workflows. |

## Rules every session follows

1. **Log what you did in today's daily note.** Append one line under `## Activity` in `00 Human/10 Daily Notes/YYYY-MM-DD.md`: time, what you did, and a link to anything you made. If today's note does not exist, create it from `00 Human/80 Templates/Daily.md`. The owner does not journal; the log fills itself in.
2. **Numbers come from scripts, not from you.** Daily properties (followers, views, revenue, and so on) are filled by connectors, small programs in `local/connectors/` that `lcars collect` runs (see `local/AGENTS.md`). Never estimate, round, or carry a number forward. If a value cannot be read, the script writes `unknown`. Never write `0` for a missing value.
3. **Properties are the database.** Every note of a type has the same properties, spelled the same way, with values from the same fixed list. Use the template's property names exactly. Do not invent new statuses like "working on it"; use the ones in the template.
4. **Before a workflow, read its folder.** Use `local/workflows/<name>/` if it exists, else `Machine/Workflows/<name>/`. Open its `AGENTS.md`, then `FINDINGS.md`, then `SKILL.md`. Pull in only the inputs `AGENTS.md` lists.
5. **After a workflow, write down what you learned.** Add a dated entry to that workflow's `FINDINGS.md`: what happened, the evidence (numbers, links), and the lesson for next time. This is how every run gets better than the last. It is not optional.
6. **Never put passwords, API keys, or tokens in a note.** Scripts read secrets from environment variables.

## Owner overrides

The core files here are installed and upgraded by `lcars`. The owner customizes them without editing them:

1. Read each `AGENTS.md` from the workspace root down to the folder you work in.
2. Then read each `AGENTS.local.md` on the same path, root first.
3. Where two rules disagree, the later file wins. Any `AGENTS.local.md` beats any `AGENTS.md`.
4. A folder in `local/workflows/` or `local/connectors/` replaces the core workflow or connector with the same name.

Never edit an `AGENTS.local.md` or anything in `local/` unless the owner asks; they are the owner's.

## Stop and ask first

- Sending, publishing, or scheduling anything that leaves this computer (email, posts, DMs).
- Deleting notes, or moving or renaming many notes at once.
- Rewriting anything the owner wrote.
- Changing a template's properties (that changes the database for every future note).

## New here?

If the daily template has no tracked numbers yet, the workspace has not been set up. Run the onboarding workflow: `Machine/Workflows/onboarding/`. It asks the owner what to track and shapes the templates around their answers. It does not write their notes for them.

> **Owner overrides:** if an `AGENTS.local.md` sits beside this file, read it next. Where the two disagree, `AGENTS.local.md` wins.

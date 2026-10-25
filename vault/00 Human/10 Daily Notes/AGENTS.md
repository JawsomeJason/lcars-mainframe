# 10 Daily Notes

One note per day, named `YYYY-MM-DD.md`, created from `../80 Templates/Daily.md`. HQ reads the newest note that is not in the future.

## The two parts that matter

1. **Properties (top of the note).** The day's numbers and states. Every daily note carries the same property names, so this folder works like a table: one row per day. `Daily Notes.base` in this folder shows it as one.
2. **`## Activity` (bottom of the note).** The log. Every agent appends one line per job here.

## Rules

- Numbers are written by `lcars collect` from the connectors in `local/connectors/`, not by you. Do not type a number in by hand or estimate one. A failed reading is `unknown`, never `0`.
- Do not overwrite a property the owner filled in themselves.
- Do not add a property to one day only. If the owner wants to track something new, add it to the template and to `Daily Notes.base` (ask first; it changes every future day).
- Activity line format: `- HH:MM [agent or workflow] what you did. [[link to output]]`
- Do not touch the owner's sections (Focus, Tasks, anything they wrote) except to tick a task they told you is done.

> **Owner overrides:** if an `AGENTS.local.md` sits beside this file, read it next. Where the two disagree, `AGENTS.local.md` wins.

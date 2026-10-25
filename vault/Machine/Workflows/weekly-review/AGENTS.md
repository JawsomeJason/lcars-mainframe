# weekly-review

Looks at the last seven days as a table, the way `Daily Notes.base` shows them, and reports what moved.

## Read first

1. This file. 2. `FINDINGS.md`. 3. `SKILL.md`.

## Pull in only

- The **properties** of the last seven daily notes (not their full text).
- Each day's `## Activity` lines.
- Tasks completed in the last seven days (`date_completed`).

## Never

- Fill a gap in the numbers. A missing or `unknown` day stays missing in the review.
- Write the review into `00 Human/`. It goes to `Machine/Outputs/`.

## Output

`Machine/Outputs/YYYY-MM-DD weekly-review.md`

> **Owner overrides:** if an `AGENTS.local.md` sits beside this file, read it next. Where the two disagree, `AGENTS.local.md` wins.

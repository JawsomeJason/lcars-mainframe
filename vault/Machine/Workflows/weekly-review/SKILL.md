---
name: weekly-review
description: Review the last seven daily notes as a table. Show what each tracked number did, what got done, and what kept slipping. Use once a week.
---

# weekly-review

Read `AGENTS.md` and `FINDINGS.md` in this folder before starting.

## Steps

1. Read the properties of the last seven daily notes. Build a table: one row per day, one column per tracked number.
2. For each number: first and last known value, and the change. Count `unknown` days and list them; do not average over them.
3. List tasks completed this week, and tasks that were carried or rescheduled more than once.
4. List the workflows that ran (from `## Activity`) and link their outputs.
5. Write it all to `Machine/Outputs/YYYY-MM-DD weekly-review.md`. Keep it to one screen.
6. Append to today's `## Activity`: `- HH:MM [weekly-review] Weekly review. [[YYYY-MM-DD weekly-review]]`
7. Add a `FINDINGS.md` entry: anything the owner said mattered or did not, so next week's review shows more of the first and less of the second.

---
name: today
description: Start the day. Run the connectors, read today's note and what is overdue, and suggest the one most important next move. Use at the start of a work day.
---

# today

Read `AGENTS.md` and `FINDINGS.md` in this folder before starting.

## Steps

1. Run the connectors: `lcars collect` (or `npx lcars-mainframe collect` if `lcars` is not installed). Report any `unknown` readings by name; do not fix them by hand.
2. Open today's daily note. Create it from the template if missing.
3. List, in this order:
   - Overdue tasks (due date before today), oldest first. Anything pushed more than two days goes to the top.
   - Tasks due today.
   - Blocked tasks.
   - Yesterday's unticked tasks.
4. Compare today's numbers with the last seven daily notes. Mention only real changes; skip `unknown` values.
5. Suggest **one** #1 for today and up to three others, each with the reason in one line. Use the "Current best practice" in `FINDINGS.md` if it says what tends to matter most.
6. When the owner picks, write their #1 into `## Focus` in their words.
7. Append to `## Activity`: `- HH:MM [today] Collected numbers; planned the day.`
8. Add a `FINDINGS.md` entry only if something was learned (a suggestion the owner rejected and why, a connector that keeps failing).

---
name: close-day
description: Close the day. Confirm what got done, update task statuses, carry unfinished tasks forward, and complete the activity log. Use at the end of a work day.
---

# close-day

Read `AGENTS.md` and `FINDINGS.md` in this folder before starting.

## Steps

1. Read today's `## Tasks` and `## Activity`.
2. Ask the owner which tasks are done. Tick those. For linked task notes set `status: completed` and `date_completed`.
3. For each unfinished task, ask: carry to tomorrow, reschedule (new `due_date`), or drop. Apply their answer.
4. If they want, create tomorrow's daily note from the template and copy the carried tasks into its `## Tasks`.
5. Append to `## Activity`: `- HH:MM [close-day] Closed the day: N done, N carried.`
6. Add a `FINDINGS.md` entry only if a pattern shows up (the same task carried three days running, for example).

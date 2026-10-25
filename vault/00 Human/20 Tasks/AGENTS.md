# 20 Tasks

One task per file, created from `../80 Templates/Task.md`.

## Rules

- `status` uses only the template values: `pending`, `in-progress`, `blocked`, `review`, `completed`. No free text like "working on it".
- `due_date` is a real date (`YYYY-MM-DD`) or empty. Overdue tasks are how HQ decides what to pull to the front, so keep dates honest.
- Link the task to its project with `project: "[[Project Name]]"`. A task without a project does not show on the Projects page.
- When a task is done, set `status: completed` and `date_completed`. Do not delete it.
- Write the task in the owner's words. Do not expand it into a plan unless they ask; a plan goes in `Machine/`.

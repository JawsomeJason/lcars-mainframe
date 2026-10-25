# Machine/Scripts

Code that runs without a model. Scripts do the jobs that must come out exactly the same every time: reading numbers, moving files, building reports.

| Folder | What it does |
|---|---|
| `collectors/` | One small script per data source. Each fills one daily-note property. `collect.cjs` runs them all. |

## Rules

- A script that cannot get a real value reports `unknown`. It never writes `0`, a guess, or yesterday's value.
- Secrets come from environment variables. Never put a key in a script or a note.
- Every script supports a dry run, or is safe to run twice.
- When you add a script, add a line for it to the table above.

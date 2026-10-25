# Machine/Workflows

Repeatable jobs. **One folder per workflow.** A workflow folder holds everything the job needs, so an agent can work from that folder alone instead of reading the whole workspace.

## What every workflow folder contains

| File | What it is |
|---|---|
| `AGENTS.md` | The ground rules for this job: what to read, what to pull in (and what not to), where output goes, what never to touch. Read first. |
| `FINDINGS.md` | What earlier runs learned: results, numbers, what worked, what flopped. Read before running. Add to it after every run. |
| `SKILL.md` | The steps. It has `name` and `description` at the top so Claude Code, Codex, Pi, and similar tools can load it as a skill. |
| `references/` (optional) | Stable inputs the job reuses: examples, assets, checklists. |

Outputs do not live here. They go to `Machine/Outputs/YYYY-MM-DD <name>/`.

## How to run one

1. Read `<workflow>/AGENTS.md`.
2. Read `<workflow>/FINDINGS.md`, especially "Current best practice".
3. Follow `<workflow>/SKILL.md`. Pull only the inputs `AGENTS.md` lists.
4. Save the result to `Machine/Outputs/`.
5. Add a line to today's daily note `## Activity`.
6. Add a dated entry to `FINDINGS.md`. Come back later and add the real performance numbers when they exist.

## Workflows in this workspace

| Folder | Use it to |
|---|---|
| `onboarding/` | Set the workspace up: choose the daily numbers and content fields to track. Run once, then whenever tracking changes. |
| `today/` | Start the day: collect numbers, read today's note, pick the most important next move. |
| `close-day/` | End the day: tick what got done, roll over what did not, note what changed. |
| `weekly-review/` | Look at the last seven daily notes as a table and see what moved. |
| `content-research/` | Research a topic from real videos and comments; narrow to ideas likely to work for this owner. |
| `_template/` | Copy this folder to make a new workflow. |

## Adding a workflow

Copy `_template/` to a new lowercase-hyphenated folder name, fill in the three files, and add a row to the table above. Keep `FINDINGS.md` empty until there is a real run to record. Never invent findings.

## Using these as skills in an AI tool

The `SKILL.md` files work as skills where the tool loads skill folders. Point the tool at this folder (for example, link `Machine/Workflows/<name>` into the tool's skills folder) rather than copying, so there is one copy to keep current.

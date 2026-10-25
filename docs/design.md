# Design: core and instance

## Problem

A Memory Alpha vault is an Obsidian folder used as a backend: `00 Human/` holds the owner's notes, `Machine/` holds workflows anyone's AI can run, and daily numbers come from scripts. The first vault mixed three things: the generic system, one owner's private data sources, and that owner's notes. lcars-mainframe is the generic system; a vault is an install of it.

Two constraints make the shape non-obvious:

- **Onboarding edits files the core ships.** It adds properties to `80 Templates/Daily.md` and columns and formulas to `Daily Notes.base`. "The core shipped this file" cannot mean "the core may overwrite it".
- **A vault must work with no AI, no git and no network.** It may be synced by Syncthing, run under launchd, and read by any agent tool. Correctness cannot depend on git in the vault or on fetching an older core.

## Usage

```sh
npm i -g lcars-mainframe          # or: node ~/code/lcars-mainframe/bin/lcars.js
lcars init ~/Notes                # preview, confirm, write; never overwrites an existing file
cd ~/Notes
lcars status                      # version, edited core files, pending .new files, connectors
lcars collect --dry-run           # run connectors for tracked properties, print, write nothing
lcars collect                     # write today's daily note properties
lcars upgrade                     # preview the plan and diffs, confirm, apply
lcars schedule install --at 07:00 --env-file ~/.config/zsh/local.zsh
```

A connector, in the vault:

```
local/connectors/jira/connector.json   {"properties":["jira_in_progress"],"run":["node","jira.cjs"],
                                        "env":["ATLASSIAN_EMAIL","ATLASSIAN_API_TOKEN"]}
local/connectors/jira/jira.cjs         prints {"jira_in_progress": 14}
```

It runs because `jira_in_progress:` sits, empty, in the Daily template's frontmatter. A tracked property no connector provides is typed by the owner.

## Shape

### Where things live

| Store | Owner | Holds |
|---|---|---|
| `vault/` in the package | core | Every file an install receives. Walking it is the ship list. |
| `connectors/` and `lib/` in the package | core | The runner and the neutral example connector. No code is copied into a vault. |
| Daily template frontmatter | owner | Which properties are tracked, in which order. The template is the schema. |
| `local/` in the vault | owner | The owner's connectors and workflows. |
| `.lcars/install.json` | lcars | Per installed file: its class and the hash of the core text last installed. |
| `.lcars/base/<sha256>` | lcars | That core text, content-addressed. A 3-way merge needs text, not a hash. |

### File classes

One rule decides a file's class from its path (`lib/sync.js`, `classify`):

- **seed:** `.obsidian/**`, `**/FINDINGS.md`, `.gitignore`. Written once when absent, then the owner's. Never compared or merged: Obsidian rewrites its JSON and FINDINGS fill with run data.
- **system:** everything else under `vault/`. Upgrades carry core changes into it with a 3-way merge.
- **owner:** anything not under `vault/`. lcars never touches it, apart from the daily note `collect` writes.

### Upgrade

`init` and `upgrade` are one function over three inputs: `theirs` (the package's `vault/`), the record, and `mine` (the vault). `init` refuses an existing record; `upgrade` requires one. The pure planner returns one action per path in `theirs ∪ record`:

| Class | Record | On disk | Condition | Action |
|---|---|---|---|---|
| seed | none | missing | | create |
| seed | none | present | | record (owner's copy wins) |
| seed | yes | any | | noop; `forget` if core dropped it |
| system | none | missing | | create |
| system | none | present | mine = theirs | record |
| system | none | present | mine ≠ theirs | keep: base := theirs, owner's file stays |
| system | yes | missing | | keep-deleted: the owner removed it |
| system | yes | present | mine = theirs | record (noop if the base already matches) |
| system | yes | present | base unreadable | conflict |
| system | yes | present | mine = base | replace |
| system | yes | present | theirs = base | noop: owner edits stay |
| system | yes | present | otherwise | merge, or conflict when it does not merge clean |
| system | yes, core dropped it | present | mine = base | delete |
| system | yes, core dropped it | present | mine ≠ base | orphan: left in place, forgotten |
| system | yes, core dropped it | missing | | forget |

A conflict leaves the owner's file untouched, writes the core version beside it as `<file>.new`, and records base := theirs, so the `.new` is offered once rather than on every run. The merge is `git merge-file` on temp copies. Without git, every non-trivial case is a conflict: the fallback can only ask more, never lose an edit.

**Apply order:** new base blobs, then vault files (each to a temp name, then rename), then `install.json`, then unreferenced blobs are removed. A `.lcars/lock` taken with `O_EXCL` keeps two runs apart; a lock whose process is gone is stale.

**Run twice:** every path plans as noop, nothing is written, and `install.json` is not rewritten.

**Crash halfway:** the old record and its blobs are intact until the record flips. A replaced or created file now equals theirs and is recorded. A merged file merges with the same core change again and gives the same text. A `.new` is rewritten with the same bytes.

### Connectors

`connector.json`: `properties` (string[], snake_case, required), `run` (argv, no shell, cwd = the connector folder, `node` = the running Node), `env` and `bin` (names that must be set or on PATH), `timeoutSeconds` (default 20), `description`.

Discovery: `local/connectors/*` in the vault, then `connectors/*` in the package. A local folder shadows a core one of the same name. Output: a JSON object, `key=value` lines, or a bare number for a single-property connector. A non-zero exit, timeout, missing env var or program, missing key or non-finite value writes `unknown`, never 0. Two connectors claiming one property is an error, and that property is `unknown`.

`collect` runs only connectors whose properties are tracked, in the template's order. `--only <name>` runs one connector even while it is untracked, to test it before onboarding adds the property.

### Overrides

Plain reading order, written in the root `AGENTS.md` and as a footer on every shipped `AGENTS.md` (a test enforces the footer):

1. Read each `AGENTS.md` from the vault root down to the folder you work in.
2. Then read each `AGENTS.local.md` on the same path, root first.
3. On a conflict the later file wins: any owner rule beats any core rule.
4. `local/workflows/<name>/` replaces `Machine/Workflows/<name>/`, and `local/connectors/<name>/` replaces a core connector.

### Scheduling

`lcars schedule install` writes a launchd agent on macOS that runs `lcars collect` with the PATH captured at install time. `--env-file` sources one file (and nothing else from the shell profile) in the owner's shell before the run, because launchd loads no profile. Elsewhere it prints a crontab line.

## Synthesis decision

Three candidates were sketched (Opus, Fable, Sonnet) and judged by an independent reviewer (A 22, B 21, C 20 on a six-part rubric). Base: **B**, code in the package and only data in the vault, the smallest public surface. Grafted from **A**: the full planner table, base := theirs after a conflict, the lock, and the Daily template as the list of tracked properties (removing `collectors.json` and any `enabled` flag). Grafted from **C**: content-addressed blobs, a canonical record never rewritten on a noop, and the purity and footer tests. Rejected from C: generated "slot" regions in templates and an `lcars.json` registry (one more store, and Obsidian may strip the YAML comments the slots depend on), and an env-file parser (it cannot expand `$VAR` references, which the first owner's env file uses).

## Tradeoffs accepted

- We accept that collecting needs `lcars` installed, in exchange for no code in the vault and nothing code-like to merge.
- We accept storing base copies of core text (tens of KB) in exchange for real merges with no git history or network.
- We accept that a vault without git gets `.new` files instead of auto-merges, in exchange for zero dependencies.
- We accept that seeds never receive core changes, in exchange for never merging Obsidian's own JSON or run data.
- We accept that an owner edit directly beside a core edit (adjacent lines) conflicts, because that is git's rule; the owner gets a `.new`, never a lost edit.

## Alternatives considered

- **Runner copied into every vault** (A). Works without a global install, but the CLI exists twice and its JavaScript is merged on upgrade.
- **Generated template regions from a registry** (C). Solves adjacent-line conflicts for tracked properties, at the cost of a second store and a dependence on Obsidian keeping comments.
- **A manifest of file classes and hashes.** Two lists that must agree with the `vault/` tree; the path rule plus the record derives both.

## Implementation reconciliation

Accepted after an independent review of 0.1.0 (each with a regression test):

- `apply` re-hashes every file it will write, under the lock, and writes nothing if one changed after the plan was shown.
- A path the core dropped that matches a shipped path except for case is forgotten, not deleted (case-insensitive disks).
- A conflict never overwrites an existing, different `<file>.new`; the newer core text goes to `<file>.<version>.new`.
- `install.json` paths must stay inside the vault: a synced vault is untrusted input.
- `upgrade` refuses to go back to an older lcars without `--force`.
- Unknown CLI flags are errors, and `--key=value` is accepted.
- `collect` never replaces a value already in today's note with `unknown`; it reports the failure and keeps the value. This refines "failures write `unknown`": they do, into an empty field.
- A connector runs in its own process group so a timeout kills what it started; the daily note is written atomically.
- The `--env-file` wrapper runs collect even when the env file's last command exits non-zero.

## Open questions

- Two machines upgrading one Syncthing vault at once: the lock is per machine. Document "upgrade on one machine".
- Should `orphan` leave a marker for the owner to review? It is reported once and then forgotten.

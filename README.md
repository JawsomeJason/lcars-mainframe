# lcars-mainframe

LCARS installs, upgrades and runs a **Memory Alpha vault**: an Obsidian folder that works as a backend. You write in `00 Human/`. Scripts and any AI tool work in `Machine/`, following the `AGENTS.md` in each folder. Your daily numbers are filled by small programs called connectors, not typed by an AI.

Everything is plain Markdown and plain scripts. No AI is needed for the core: collecting numbers, scheduling, daily notes, dashboards and upgrades all run without one.

## Install

Needs Node 22 or later. Git is optional; with it, upgrades merge your edits automatically.

```sh
npm i -g lcars-mainframe
lcars init ~/Notes          # shows every file it will add, then asks
```

Open `~/Notes` in Obsidian, then run the onboarding workflow with your AI tool: `Machine/Workflows/onboarding/`.

## Use

```sh
lcars status                # version, core files you changed, connector health
lcars collect --dry-run     # read every tracked number, write nothing
lcars collect               # write them into today's daily note
lcars schedule install --at 07:00 --env-file ~/.env.lcars
lcars upgrade               # after `npm i -g lcars-mainframe@latest`
```

## Connectors

A connector is a folder in `local/connectors/` with a `connector.json` and any program that prints numbers:

```json
{
  "description": "Open pull requests assigned to me.",
  "properties": ["open_prs"],
  "run": ["node", "open-prs.cjs"],
  "env": ["GITHUB_TOKEN"],
  "bin": []
}
```

The program prints a JSON object (`{"open_prs": 3}`), `key=value` lines, or one bare number. A connector runs when its property is listed, empty, in the frontmatter of `00 Human/80 Templates/Daily.md`. A failure is written as `unknown`, never `0`. See `local/AGENTS.md` in a vault for the full rules, and `connectors/youtube/` here for an example.

## Make it yours without forking

- **Rules:** put an `AGENTS.local.md` next to any `AGENTS.md`. Your file wins.
- **Workflows and connectors:** put them in `local/workflows/<name>/` and `local/connectors/<name>/`. One with the same name as a core one replaces it.
- **Core files:** edit them if you want. `lcars upgrade` merges your edit with the new version. When both changed the same lines, your file stays as it is and the new version is written beside it as `<file>.new`.

`lcars` tracks what it installed in `.lcars/` inside the vault. Keep that folder; sync it with the rest of the vault.

## Credits

The vault layout, workflows and the Human vs Machine split come from Eric Michaud's EMAI (Easy Machine AI) Starter Vault, shown in his video [Build an Obsidian BACKEND Not a Second Brain!](https://youtu.be/4z2i6UsQG1k). Community: <https://www.skool.com/easymachineai>.

Design notes: [docs/design.md](docs/design.md).

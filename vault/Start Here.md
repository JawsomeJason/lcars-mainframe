# Memory Alpha

This is Memory Alpha, your workspace: ordinary Markdown files in a folder you own. Obsidian is the recommended editor. HQ, the front end, reads the same files, and it can read them when Obsidian is closed. Any AI tool you use can read and write here too. Nothing is locked in.

> Built from Eric Michaud's EMAI (Easy Machine AI) Starter Vault, from his video "Build an Obsidian BACKEND Not a Second Brain!" (https://youtu.be/4z2i6UsQG1k). Community: https://www.skool.com/easymachineai. "HQ" in these files is his front-end app.

## The idea in four lines

1. **Your side and the AI's side are separate.** `00 Human/` is yours. `Machine/` is where agents and scripts work.
2. **Every folder has an `AGENTS.md`.** It tells any AI what goes in that folder and what not to touch. The one at the top is the map.
3. **The daily note is a database row.** Same properties every day, filled by scripts, so the notes line up as a table. Agents log what they did at the bottom.
4. **Every workflow keeps a `FINDINGS.md`.** Each run records what worked, so the next run starts smarter. They start empty; your runs fill them.

## What the folders are for

- `00 Human/10 Daily Notes`: one note per day. Numbers at the top, activity log at the bottom.
- `00 Human/20 Tasks`: one task per file. Link a task to a project when you want it in Projects.
- `00 Human/30 Projects`: project notes and their next steps.
- `00 Human/40 Resources`: reference material you choose to keep.
- `00 Human/50 People`: relationship notes.
- `00 Human/70 Context`: durable context you write: business, audience, voice.
- `00 Human/80 Templates`: the shape of each note type. Their properties are the schema.
- `00 Human/90 Content`: your content tracker. New ideas go in `Ideas`.
- `Machine/Workflows`: repeatable jobs, one folder each.
- `Machine/Outputs`: results produced by HQ or its workflows.
- `local`: your own connectors (the programs that fill your daily numbers) and workflows. Upgrades never touch it.

## Opening it in Obsidian

Open this folder as a vault. Obsidian asks whether to trust its plugins: choose **Trust author and enable plugins**. The vault comes with Templater, Dataview, Calendar, Full Calendar, Style Settings, and the Blue Topaz theme. Remove any you don't want in Settings → Community plugins.

## First step

Ask your AI tool to run the **onboarding** workflow (`Machine/Workflows/onboarding`). It asks what numbers you want each morning and what you want to track for your content, then shapes the daily note and the content tracker around your answers. It does not write your notes for you. Empty folders are fine.

Your AI assistant can use the install guide to connect this folder and check that HQ reads it.

Connecting a folder does not give the AI permission to read everything in it. AI access and outside services need separate setup and checks. Keep passwords and tokens out of these notes.

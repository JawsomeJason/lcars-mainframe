---
name: onboarding
description: Set up a fresh workspace. Ask the owner which daily numbers and content fields to track, then shape the daily template, the content tracker, and the connectors around the answers. Use on first setup or when tracking changes.
---

# onboarding

Read `AGENTS.md` and `FINDINGS.md` in this folder before starting. Ask one question at a time. Short answers are fine.

## 1. Daily numbers

Ask: **"What numbers do you want to see every morning?"** Prompt with examples only if they are stuck: followers or subscribers per platform, views, email list size, community members, revenue, sales calls booked, hours slept.

For each number, agree on:

| Field | Example |
|---|---|
| Label | YouTube subscribers |
| Property name (lowercase snake_case) | `youtube_subscribers` |
| Unit | people, views, USD, hours |
| Where it comes from | an official API, a platform export, a page, or typed by hand |

Read the list back and get a yes before writing anything.

Then:

1. Add each property, empty, to the frontmatter of `00 Human/80 Templates/Daily.md`, below the comment line.
2. Add each property name to `order:` in `00 Human/10 Daily Notes/Daily Notes.base` so it shows as a column.

A property in the template is tracked. If a connector provides it, `lcars collect` fills it; if none does, the owner types it and no agent ever fills it.

## 2. Connectors

For each number a program can read, write or reuse a connector in `local/connectors/<name>/`, following `local/AGENTS.md`. Tell the owner the exact environment variable to set for its key. Never ask for the key itself.

Test it: `lcars collect --only <name> --dry-run`

A connector that cannot reach its source must fail (exit non-zero), so the number is written as `unknown`. Run `lcars status` to see which properties have a working connector.

## 3. Content tracker

Ask: **"What do you make, and what do you want to keep track of for each piece?"** Typical answers: platform, format (short, long, post, email), status, publish date, link, views after 7 days.

1. Agree on the status list. Keep it short and in the owner's words, but fixed. Replace the `# status:` comment line in `00 Human/80 Templates/Content Idea.md` with their list.
2. Add each agreed field as an empty property to `Content Idea.md`.
3. Add each field to `order:` in `00 Human/90 Content/Content.base`.

## 4. Context (optional)

Ask whether they want to write `Business.md`, `Audience.md`, or `Voice.md` in `00 Human/70 Context/`. If yes, create empty notes with a heading each. **They write the content.** Do not draft it for them.

## 5. HQ metrics (if HQ is installed)

HQ reads numeric properties straight from the daily notes. Once a daily note has a real number in a property, the owner can add it in HQ: **Metrics → Customize metrics**, where it is listed under Obsidian. Tell them this; the choice of which cards to show is theirs.

## 6. Finish

1. Create today's daily note from the template if it does not exist, so the owner can see the new properties.
2. Append to `## Activity`: `- HH:MM [onboarding] Set up N daily numbers and the content tracker.`
3. Add a `FINDINGS.md` entry in this folder.
4. Tell the owner, in three lines or fewer, what is tracked, what fills each number, and which environment variables they still need to set.

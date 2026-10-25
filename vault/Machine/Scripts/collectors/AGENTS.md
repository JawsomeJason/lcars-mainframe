# Machine/Scripts/collectors

Collectors fill the numbers at the top of each daily note. **A script does this, not an AI**, so the same field is filled the same way every day and no number ever passes through a chat.

## How it works

- `collectors.json` lists every tracked daily number: its property name, and either the script that reads it or `"manual": true` if the owner types it.
- `collect.cjs` runs every enabled collector and writes the results into today's note (`00 Human/10 Daily Notes/YYYY-MM-DD.md`), creating the note from the template if needed.
- If a source is down or a key is missing, the property is written as `unknown`. Never `0`.

```
node "Machine/Scripts/collectors/collect.cjs"            # collect and write
node "Machine/Scripts/collectors/collect.cjs" --dry-run  # collect and print only
```

## collectors.json entry

```json
{ "property": "youtube_subscribers", "script": "youtube.cjs", "enabled": true, "env": ["YOUTUBE_API_KEY", "YOUTUBE_CHANNEL_ID"] }
```

`env` lists the environment variables the script needs, so a missing one is reported by name.

## Writing a collector

A collector is a `.cjs` file in this folder that exports one async function returning a number:

```js
module.exports = async function collect() {
  // read the source; throw an Error with a clear message if it fails
  return 1234;
};
```

Rules:

1. Return one finite number, or throw. Never return a guess or a default.
2. Prefer the platform's official API. A scraper is a last resort and must be labelled as one in this file.
3. Keys come from `process.env`. Never write a key into this folder.
4. Test with `--dry-run` before setting `"enabled": true`.
5. `youtube.cjs` is a working example (official YouTube Data API).

## Schedule

Run it when the day starts (the `today` workflow does) and on a schedule if you want fresher numbers: Task Scheduler on Windows, `cron` or `launchd` on macOS. Use the same `node` that runs HQ.

## After a change

Record failures that repeat, and how they were fixed, in `FINDINGS.md` in this folder.

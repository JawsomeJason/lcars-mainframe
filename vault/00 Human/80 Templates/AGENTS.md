# 80 Templates

The shape of every note type. **The properties in these templates are the database schema.** Every note created from a template carries the same property names, which is what lets HQ, Bases, and scripts sort and count them.

| Template | Used for | Folder |
|---|---|---|
| `Daily.md` | One note per day | `10 Daily Notes/` |
| `Task.md` | One task | `20 Tasks/` |
| `Project.md` | One project | `30 Projects/` |
| `Person.md` | One person | `50 People/` |
| `Content Idea.md` | One piece of content | `90 Content/Ideas/` |

## Rules

- Use templates exactly. Do not rename properties or add one-off ones to a single note.
- Changing a template changes every future note. Ask the owner first, then add the property as a column in the matching `.base` view.
- Property names are lowercase `snake_case` with no spaces (`youtube_subscribers`, not `YouTube Subs`).
- Status-like properties use a short fixed list of values, written in the template. Keep that list short.
- The onboarding workflow (`Machine/Workflows/onboarding/`) is the normal way these get shaped to the owner.

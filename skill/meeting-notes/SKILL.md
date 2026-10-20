---
name: meeting-notes
description: Turn raw meeting notes or a transcript into clean minutes with decisions and action items. Use when the user pastes meeting notes, a transcript or asks to write up a meeting.
---

# Meeting notes

Turn messy notes or a transcript into minutes someone who missed the meeting can act on.

## Rules

- Use only what is in the notes. If something is unclear (owner, date, outcome), write
  `(unclear)` rather than guessing.
- Decisions and action items matter most; discussion is a short summary, not a replay.
- Keep people's names exactly as written in the notes. Do not add attendees.
- Dates: keep them as stated; if a relative date ("next Friday") is given, keep it as is.
- No more than about 300 words for a one-hour meeting unless the user asks for detail.

## Format

```markdown
## <Meeting title> - <date, if given>

**Attendees:** <names, if given>

**Summary**
<2-4 sentences: purpose and outcome>

**Decisions**
- <decision>

**Action items**
| Owner | Action | Due |
|---|---|---|
| <name or (unclear)> | <verb-first action> | <date or -> |

**Open questions**
- <question still unanswered>
```

Leave out an empty section. After the minutes, offer one follow-up in a single line, for
example drafting the follow-up email.

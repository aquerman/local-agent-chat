---
name: morning-brief
description: Write a short start-of-day brief (date, weather, headlines, the user's plan and priorities). Use when the user asks for a morning brief, daily brief or "what's on today".
---

# Morning brief

Produce a brief the user can read in under a minute. Keep it short; skip any section you have
nothing real for instead of padding it.

## Steps

1. Use today's date from the conversation context. Do not guess it.
2. If a `search` tool is available, run at most two searches: one for top news headlines
   today, and one for the weather if the user has told you their city. Do not fetch whole pages.
3. Use what the user gave you in this chat (calendar, tasks, notes). Never invent meetings,
   tasks or numbers.
4. Write the brief in the format below.

## Format

```markdown
## Morning brief - <weekday> <date>

**Weather:** <one line, or leave out>

**Headlines**
- <headline, one line each, at most 3>

**Today**
- <fixed appointments, earliest first>

**Top 3 priorities**
1. <most important thing>
2. ...
3. ...

**Heads-up:** <one deadline or risk worth knowing, or leave out>
```

If the user gave no plan or tasks, end with one question: "What are the one to three things
that would make today a good day?"

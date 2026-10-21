---
name: deep-research
description: Research a question across several web pages and deliver a cited report as a PDF, Word or Markdown document. Use when the user asks for research, a report, an overview or a comparison that needs more than one source.
---

# Deep research

Three phases: plan, research, report. Keep every step small: write down only what you need, never
paste whole pages.

## 1. Plan

- If the request is too vague to research (unclear topic or goal), ask one short question and stop.
- Otherwise start your reply with the plan, then begin at once (do not wait for approval):

```markdown
**Research plan:** <one line: what the report will answer>
1. <sub-question>
2. <sub-question>
```

Use 3-6 sub-questions, fewer for a narrow topic. Each must be answerable from web pages. In the
same reply, right after the plan, call `search` for sub-question 1.

## 2. Research, one sub-question at a time

For each sub-question, in order:

1. Call `search` once with a short query (3-8 words). Search again only if no result fits.
2. Pick the 1-3 best results (official, primary or recent pages over forums and listicles) and call
   `fetch` on each with `maxChars: 6000`. If a fetch fails, try the next result once.
3. Only after fetching, and before the next sub-question, write a note in your reply, at most
   150 words (search snippets alone are not a source):

```markdown
**Q1. <sub-question>**
- <finding, with numbers and dates where the page gives them> [1]
- <finding> [2]
Sources: [1] <page title> <url> · [2] <page title> <url>
```

Number sources once for the whole run (1, 2, 3, ...) and reuse a number when you cite the same
page again. Write only what the fetched pages say, and cite only pages you fetched in this run:
never from memory. If they do not answer, write "Not found" and move on.

## 3. Report

When every sub-question has a note, write the report from your notes (do not fetch again):

1. `create_document` with `format` (`pdf` by default; `docx` or `md` if the user asked for Word or
   Markdown), a `title`, and as `content` a `## Summary` section: 3-5 sentences that answer the
   request, with citations.
2. `append_section` once per sub-question: `## <short heading>`, then 80-200 words built from that
   note, every claim cited inline like [3].
3. `append_section` with `## Sources`: a numbered list, one line each: `1. <page title> - <url>`.

Then end with two or three lines in the chat: the main answer and that the report is attached.
Do not repeat the report.

## Short runs

If you are not the Researcher agent, keep the run short: 3 sub-questions, 1 source each, and write
the whole report in a single `create_document` call (Summary, one section per sub-question,
Sources). Mention that the Researcher agent can go deeper.

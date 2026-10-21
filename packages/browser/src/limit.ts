import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

type Content = CallToolResult['content'][number];

export const EMPTY_RESULT_NOTE =
  'Done. Call browser_snapshot (or browser_find with a word you expect) to see the page now.';

export function truncationNote(kept: number, total: number): string {
  return (
    `\n\n[Cut at ${kept} of ${total} characters. To read the rest, call browser_find with a word ` +
    'from the part you need, or browser_snapshot with target set to a ref shown above.]'
  );
}

function isText(part: Content): part is Extract<Content, { type: 'text' }> {
  return part.type === 'text';
}

/**
 * Keeps one tool result inside `maxChars`: only text parts survive (the model has no vision), and
 * the joined text is cut with a note that tells the model how to read the rest without taking a
 * bigger snapshot. An empty success gets a short hint instead of nothing.
 */
export function limitResult(result: CallToolResult, maxChars: number): CallToolResult {
  const text = result.content
    .filter(isText)
    .map((part) => part.text)
    .join('\n')
    .trim();
  if (text === '') {
    return { content: [{ type: 'text', text: EMPTY_RESULT_NOTE }], isError: result.isError };
  }
  if (text.length <= maxChars) {
    return { content: [{ type: 'text', text }], isError: result.isError };
  }
  const cut = text.lastIndexOf('\n', maxChars);
  const kept = text.slice(0, cut > maxChars / 2 ? cut : maxChars);
  return {
    content: [{ type: 'text', text: kept + truncationNote(kept.length, text.length) }],
    isError: result.isError,
  };
}

const PAGE_URL_LINE = /^- Page URL: (\S+)$/m;

/** The page URL Playwright MCP reports in a result's "### Page" section, if any. */
export function reportedPageUrl(result: CallToolResult): string | undefined {
  for (const part of result.content) {
    if (!isText(part)) {
      continue;
    }
    const match = part.text.match(PAGE_URL_LINE);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

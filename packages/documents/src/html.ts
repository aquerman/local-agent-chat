import { Marked } from 'marked';
import { THEME } from '~/theme';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/**
 * Raw HTML in the model's Markdown is shown as text, and images as their alt text: the page is
 * printed offline with scripts off, so neither could do anything useful and both could do harm.
 */
const marked = new Marked({
  gfm: true,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    image({ text }) {
      return escapeHtml(text === '' ? '[image]' : `[image: ${text}]`);
    },
  },
});

const color = (hex: string): string => `#${hex}`;

const STYLE = `
@page { margin: 22mm 20mm; }
* { box-sizing: border-box; }
body { font-family: ${THEME.cssBodyFont}; font-size: 11pt; line-height: 1.45; color: ${color(THEME.textColor)}; margin: 0; }
h1, h2, h3, h4, h5, h6 { color: ${color(THEME.headingColor)}; line-height: 1.2; margin: 1.1em 0 0.45em; break-after: avoid; }
h1.title { font-size: 24pt; margin-top: 0; padding-bottom: 6pt; border-bottom: 2pt solid ${color(THEME.accentColor)}; }
h1 { font-size: 16pt; } h2 { font-size: 14pt; } h3 { font-size: 12pt; } h4, h5, h6 { font-size: 11pt; }
p { margin: 0 0 0.6em; }
a { color: ${color(THEME.linkColor)}; }
ul, ol { margin: 0 0 0.6em; padding-left: 1.6em; }
li { margin: 0.15em 0; }
code { font-family: ${THEME.cssMonoFont}; font-size: 9.5pt; background: ${color(THEME.codeBackground)}; padding: 0 3px; border-radius: 3px; }
pre { background: ${color(THEME.codeBackground)}; padding: 8pt 10pt; border-radius: 4px; white-space: pre-wrap; word-break: break-word; break-inside: avoid; }
pre code { padding: 0; background: none; }
blockquote { margin: 0 0 0.6em; padding: 0 0 0 10pt; border-left: 3pt solid ${color(THEME.ruleColor)}; color: ${color(THEME.mutedColor)}; font-style: italic; }
table { border-collapse: collapse; width: 100%; margin: 0 0 0.8em; break-inside: auto; }
th, td { border: 1px solid ${color(THEME.ruleColor)}; padding: 4pt 6pt; text-align: left; vertical-align: top; }
th[align='center'], td[align='center'] { text-align: center; }
th[align='right'], td[align='right'] { text-align: right; }
th { background: ${color(THEME.tableHeaderBackground)}; }
tr { break-inside: avoid; }
hr { border: none; border-top: 1px solid ${color(THEME.ruleColor)}; margin: 1em 0; }
`;

/** Builds the self-contained HTML page the PDF is printed from. */
export function buildHtml(title: string, sections: string[]): string {
  const body = sections.map((section) => marked.parse(section, { async: false })).join('\n');
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${STYLE}</style>`,
    '</head><body>',
    `<h1 class="title">${escapeHtml(title)}</h1>`,
    body,
    '</body></html>',
  ].join('\n');
}

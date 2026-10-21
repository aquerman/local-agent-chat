import { Lexer } from 'marked';
import type { Token, Tokens } from 'marked';

/** A run of text with the inline styles Markdown can express. */
export interface Inline {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: string;
  /** A hard line break before this run. */
  breakBefore?: boolean;
}

export interface ListItem {
  blocks: Block[];
}

export type Block =
  | { type: 'heading'; level: number; inlines: Inline[] }
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { type: 'code'; lang: string; text: string }
  | {
      type: 'table';
      align: Array<'left' | 'center' | 'right' | null>;
      header: Inline[][];
      rows: Inline[][][];
    }
  | { type: 'quote'; blocks: Block[] }
  | { type: 'rule' };

type Style = Omit<Inline, 'text' | 'breakBefore'>;

function inlineTokens(tokens: Token[] | undefined, style: Style): Inline[] {
  if (tokens === undefined) {
    return [];
  }
  return tokens.flatMap((token) => inlineToken(token, style));
}

function inlineToken(token: Token, style: Style): Inline[] {
  switch (token.type) {
    case 'strong':
      return inlineTokens((token as Tokens.Strong).tokens, { ...style, bold: true });
    case 'em':
      return inlineTokens((token as Tokens.Em).tokens, { ...style, italic: true });
    case 'del':
      return inlineTokens((token as Tokens.Del).tokens, { ...style, strike: true });
    case 'codespan':
      return [{ ...style, text: decodeEntities((token as Tokens.Codespan).text), code: true }];
    case 'link': {
      const link = token as Tokens.Link;
      return inlineTokens(link.tokens, { ...style, link: link.href });
    }
    case 'image': {
      const image = token as Tokens.Image;
      return [{ ...style, text: image.text === '' ? '[image]' : `[image: ${image.text}]` }];
    }
    case 'br':
      return [{ ...style, text: '', breakBefore: true }];
    case 'text': {
      const text = token as Tokens.Text;
      if (text.tokens !== undefined && text.tokens.length > 0) {
        return inlineTokens(text.tokens, style);
      }
      return [{ ...style, text: decodeEntities(text.text) }];
    }
    case 'escape':
      return [{ ...style, text: decodeEntities((token as Tokens.Escape).text) }];
    default:
      return [{ ...style, text: decodeEntities(token.raw) }];
  }
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** marked HTML-escapes text in tokens; Word and PowerPoint need the literal characters. */
function decodeEntities(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}

function blockToken(token: Token): Block[] {
  switch (token.type) {
    case 'heading': {
      const heading = token as Tokens.Heading;
      return [{ type: 'heading', level: heading.depth, inlines: inlineTokens(heading.tokens, {}) }];
    }
    case 'paragraph':
      return [{ type: 'paragraph', inlines: inlineTokens((token as Tokens.Paragraph).tokens, {}) }];
    case 'text': {
      const text = token as Tokens.Text;
      const inlines =
        text.tokens !== undefined
          ? inlineTokens(text.tokens, {})
          : [{ text: decodeEntities(text.text) }];
      return [{ type: 'paragraph', inlines }];
    }
    case 'list': {
      const list = token as Tokens.List;
      const items = list.items.map((item) => ({ blocks: blockTokens(item.tokens) }));
      const start = typeof list.start === 'number' ? list.start : 1;
      return [{ type: 'list', ordered: list.ordered, start, items }];
    }
    case 'code': {
      const code = token as Tokens.Code;
      return [{ type: 'code', lang: code.lang ?? '', text: code.text }];
    }
    case 'table': {
      const table = token as Tokens.Table;
      return [
        {
          type: 'table',
          align: table.align,
          header: table.header.map((cell) => inlineTokens(cell.tokens, {})),
          rows: table.rows.map((row) => row.map((cell) => inlineTokens(cell.tokens, {}))),
        },
      ];
    }
    case 'blockquote':
      return [{ type: 'quote', blocks: blockTokens((token as Tokens.Blockquote).tokens) }];
    case 'hr':
      return [{ type: 'rule' }];
    case 'html':
      return token.raw.trim() === ''
        ? []
        : [{ type: 'paragraph', inlines: [{ text: token.raw.trim() }] }];
    default:
      return [];
  }
}

function blockTokens(tokens: Token[]): Block[] {
  return tokens.flatMap(blockToken);
}

/** Parses Markdown (GitHub flavour) into the block model every renderer shares. */
export function parseMarkdown(markdown: string): Block[] {
  return blockTokens(Lexer.lex(markdown, { gfm: true }));
}

/** Plain text of a run list, for places that cannot carry inline styles. */
export function plainText(inlines: Inline[]): string {
  return inlines
    .map((inline) => (inline.breakBefore === true ? `\n${inline.text}` : inline.text))
    .join('');
}

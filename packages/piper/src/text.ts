/**
 * Common function words per language. Counting them is enough to tell Dutch from English in a
 * chat reply, which is all the `auto` voice needs; it is not a general language identifier.
 */
const STOPWORDS: Readonly<Record<string, ReadonlySet<string>>> = {
  nl: new Set(
    'de het een en van ik je jij u is niet dat die op te met voor zijn er maar ook als bij nog wel naar dan wat kan om hij zij we wij ze hun heb hebt heeft dit deze geen kunnen wordt worden mijn jouw uw zo al door uit tot over'.split(
      ' ',
    ),
  ),
  en: new Set(
    'the a an and of i you is not that this it on to with for are be but also as at still well then what can he she we they them have has no could would will my your so all by from out until over there was were'.split(
      ' ',
    ),
  ),
};

/** Fewer hits than this and the text is too short to call; the caller falls back to its default. */
const MIN_HITS = 2;

/** Returns the ISO 639-1 code whose function words dominate `text`, or null when unclear. */
export function detectLanguage(text: string): string | null {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const scores = Object.entries(STOPWORDS).map(([language, stopwords]) => ({
    language,
    hits: words.reduce((count, word) => (stopwords.has(word) ? count + 1 : count), 0),
  }));
  const [best, second] = scores.sort((a, b) => b.hits - a.hits);
  if (!best || best.hits < MIN_HITS || best.hits === second?.hits) {
    return null;
  }
  return best.language;
}

/**
 * Strips Markdown markup that Piper would otherwise read out ("asterisk", "hash") or that is
 * not speech at all (code blocks, URLs). Link and emphasis text is kept.
 */
export function toSpeakable(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^[ \t]{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~)(\S(?:.*?\S)?)\1/g, '$2')
    .replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, ' ')
    .replace(/\|/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

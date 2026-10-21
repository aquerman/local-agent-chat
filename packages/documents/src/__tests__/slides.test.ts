import { parseOutline, slideLayout } from '~/slides';
import { DocumentsError } from '~/errors';

describe('parseOutline', () => {
  it('reads a JSON array or {slides}', () => {
    const slides = [{ title: 'One', bullets: ['a'] }];
    expect(parseOutline(JSON.stringify(slides))).toEqual(slides);
    expect(parseOutline(JSON.stringify({ slides }))).toEqual(slides);
  });

  it('explains a malformed JSON outline', () => {
    expect(() => parseOutline('[{"bullets": ["a"]}]')).toThrow(DocumentsError);
    expect(() => parseOutline('[{"title": ')).toThrow(/not valid JSON/);
  });

  it('reads a Markdown outline with nested bullets and columns', () => {
    const slides = parseOutline(
      [
        '## Why',
        '- fast',
        '  - really fast',
        '- local',
        '',
        '## Compare',
        '### Before',
        '- slow',
        '### After',
        '- quick',
        '',
        '# Questions?',
      ].join('\n'),
    );
    expect(slides).toEqual([
      { title: 'Why', bullets: ['fast', '  really fast', 'local'] },
      {
        title: 'Compare',
        leftTitle: 'Before',
        left: ['slow'],
        rightTitle: 'After',
        right: ['quick'],
      },
      { title: 'Questions?' },
    ]);
    expect(slides.map(slideLayout)).toEqual(['bullets', 'two-column', 'section']);
  });
});

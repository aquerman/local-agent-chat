import { detectLanguage, toSpeakable } from '~/text';

describe('detectLanguage', () => {
  it('recognises Dutch', () => {
    expect(
      detectLanguage('Ik heb het niet gezien, maar het is een goed idee om dat te doen.'),
    ).toBe('nl');
  });

  it('recognises English', () => {
    expect(detectLanguage('I have not seen it, but it is a good idea to do that.')).toBe('en');
  });

  it('returns null for text too short or without function words', () => {
    expect(detectLanguage('Okay')).toBeNull();
    expect(detectLanguage('42 + 7')).toBeNull();
  });
});

describe('toSpeakable', () => {
  it('drops Markdown markup but keeps the words', () => {
    const markdown =
      '## Title\n\n- **bold** and _italic_ and `code`\n1. [a link](https://example.com)\n> quote';
    expect(toSpeakable(markdown)).toBe('Title\n\nbold and italic and code\na link\nquote');
  });

  it('removes code blocks, images and bare URLs', () => {
    expect(
      toSpeakable('See ```js\nconst a = 1;\n``` and ![x](y.png) at https://example.com now'),
    ).toBe('See and at now');
  });
});

import { loader } from '@monaco-editor/react';
import { configureMonacoLoader, getMonacoBaseURL } from '../monaco';

describe('getMonacoBaseURL', () => {
  it('resolves against the document base, so a subpath deployment keeps its prefix', () => {
    expect(getMonacoBaseURL('http://localhost:3080/')).toBe('http://localhost:3080/monaco/vs');
    expect(getMonacoBaseURL('https://example.com/chat/')).toBe(
      'https://example.com/chat/monaco/vs',
    );
  });
});

describe('configureMonacoLoader', () => {
  it('points the loader at the bundled copy in production', () => {
    const spy = jest.spyOn(loader, 'config');
    configureMonacoLoader(true);
    expect(spy).toHaveBeenCalledWith({
      paths: { vs: getMonacoBaseURL(document.baseURI) },
    });
    spy.mockRestore();
  });

  it('leaves the CDN default in development', () => {
    const spy = jest.spyOn(loader, 'config');
    configureMonacoLoader(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

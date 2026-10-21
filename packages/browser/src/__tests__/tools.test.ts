import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { exposeTools, stripDroppedArguments, targetUrl } from '~/tools';

const tool = (name: string, properties: Record<string, object>, required?: string[]): Tool => ({
  name,
  inputSchema: { type: 'object', properties, ...(required ? { required } : {}) },
});

describe('exposeTools', () => {
  it('keeps the exposed tools and removes filename and boxes from their schemas', () => {
    const tools = exposeTools([
      tool('browser_snapshot', { target: {}, depth: {}, filename: {}, boxes: {} }),
      tool('browser_evaluate', { function: {} }, ['function']),
      tool('browser_run_code_unsafe', { code: {} }, ['code']),
      tool('browser_file_upload', { paths: {} }),
    ]);
    expect(tools.map((t) => t.name)).toEqual(['browser_snapshot']);
    expect(Object.keys(tools[0].inputSchema.properties ?? {})).toEqual(['target', 'depth']);
  });
});

describe('stripDroppedArguments', () => {
  it('drops filename and boxes', () => {
    expect(stripDroppedArguments({ text: 'a', filename: 'x', boxes: true })).toEqual({ text: 'a' });
    expect(stripDroppedArguments(undefined)).toEqual({});
  });
});

describe('targetUrl', () => {
  it('reads the URL of a navigation or a new tab only', () => {
    expect(targetUrl('browser_navigate', { url: 'https://a.com' })).toBe('https://a.com');
    expect(targetUrl('browser_tabs', { action: 'new', url: 'https://a.com' })).toBe(
      'https://a.com',
    );
    expect(targetUrl('browser_tabs', { action: 'select', index: 1 })).toBeUndefined();
    expect(targetUrl('browser_click', { url: 'https://a.com' })).toBeUndefined();
  });
});

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * The Playwright MCP tools the model gets. Everything else stays hidden:
 * - `browser_evaluate` and `browser_run_code_unsafe` run arbitrary JavaScript (in the page or in
 *   the Playwright server process);
 * - `browser_file_upload` and `browser_drop` hand local files to a website;
 * - `browser_take_screenshot` is useless to a model without vision;
 * - console, network, resize, emulation, hover, drag and close only cost prompt tokens.
 *
 * Playwright MCP has no flag to remove a core tool, hence this list.
 */
export const EXPOSED_TOOLS: ReadonlySet<string> = new Set([
  'browser_navigate',
  'browser_navigate_back',
  'browser_snapshot',
  'browser_find',
  'browser_wait_for',
  'browser_tabs',
  'browser_click',
  'browser_type',
  'browser_fill_form',
  'browser_select_option',
  'browser_press_key',
  'browser_handle_dialog',
]);

/**
 * Arguments removed from every exposed tool: `filename` writes a snapshot or search result to disk
 * instead of returning it, and `boxes` adds pixel coordinates a text-only model cannot use.
 */
export const DROPPED_ARGUMENTS: ReadonlySet<string> = new Set(['filename', 'boxes']);

type InputSchema = Tool['inputSchema'];

function withoutDroppedArguments(schema: InputSchema): InputSchema {
  const properties = Object.fromEntries(
    Object.entries(schema.properties ?? {}).filter(([name]) => !DROPPED_ARGUMENTS.has(name)),
  );
  const required = schema.required?.filter((name) => !DROPPED_ARGUMENTS.has(name));
  return { ...schema, properties, ...(required !== undefined ? { required } : {}) };
}

/** The exposed subset of the upstream tool list, with dropped arguments removed from schemas. */
export function exposeTools(tools: Tool[]): Tool[] {
  return tools
    .filter((tool) => EXPOSED_TOOLS.has(tool.name))
    .map((tool) => ({ ...tool, inputSchema: withoutDroppedArguments(tool.inputSchema) }));
}

export type ToolArguments = Record<string, unknown>;

export function stripDroppedArguments(args: ToolArguments | undefined): ToolArguments {
  return Object.fromEntries(
    Object.entries(args ?? {}).filter(([name]) => !DROPPED_ARGUMENTS.has(name)),
  );
}

/** The URL a call would open: `browser_navigate`'s `url`, or a new tab's `url`. */
export function targetUrl(name: string, args: ToolArguments): string | undefined {
  const url = args.url;
  if (typeof url !== 'string' || url === '') {
    return undefined;
  }
  if (name === 'browser_navigate') {
    return url;
  }
  if (name === 'browser_tabs' && args.action === 'new') {
    return url;
  }
  return undefined;
}

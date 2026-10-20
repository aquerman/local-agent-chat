/**
 * The one built-in house style every format draws from, so a Word file, a PDF and a deck made
 * from the same request look related. Colors are hex without `#`, as Office expects them.
 */
export const THEME = {
  bodyFont: 'Calibri',
  headingFont: 'Calibri',
  monoFont: 'Consolas',
  /** CSS stacks for the PDF, which may be printed on a machine without the Office fonts. */
  cssBodyFont: "Calibri, 'Segoe UI', 'Helvetica Neue', Arial, 'Liberation Sans', sans-serif",
  cssMonoFont: "Consolas, 'Cascadia Mono', 'DejaVu Sans Mono', 'Liberation Mono', monospace",
  textColor: '1F2328',
  mutedColor: '6B7280',
  headingColor: '1F3864',
  accentColor: '2F5597',
  linkColor: '0563C1',
  ruleColor: 'D0D7DE',
  codeBackground: 'F3F4F6',
  tableHeaderBackground: 'E8EEF7',
} as const;

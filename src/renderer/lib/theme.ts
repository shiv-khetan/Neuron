// App theme presets + customizable markdown colors. Applied by writing CSS
// custom properties onto <html>, so they override the defaults in index.css.

export type ColorScheme = 'dark' | 'light';

export interface ThemePreset {
  id: string;
  label: string;
  colorScheme: ColorScheme;
  tokens: Record<string, string>;
}

export interface MarkdownField {
  key: string;
  label: string;
  cssVar: string;
}

export interface Appearance {
  preset: string;
  markdownOverrides: Record<string, string>;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const TOKEN_KEYS = [
  '--canvas', '--nav', '--surface', '--surface-hover', '--divider',
  '--ink', '--ink-secondary', '--ink-muted',
  '--accent', '--accent-strong', '--positive', '--danger', '--warning', '--info',
] as const;

function preset(id: string, label: string, colorScheme: ColorScheme, values: string[]): ThemePreset {
  const tokens: Record<string, string> = {};
  TOKEN_KEYS.forEach((key, i) => { tokens[key] = values[i]; });
  return { id, label, colorScheme, tokens };
}

// Order of values matches TOKEN_KEYS above.
export const PRESETS: Record<string, ThemePreset> = {
  graphite: preset('graphite', 'Graphite', 'dark', [
    '#16181d', '#121419', '#1d2128', '#272c35', 'rgba(255,255,255,0.09)',
    '#e6e8ec', '#b3b9c4', '#7c8493',
    '#7fb1e3', '#a9cef0', '#7ed8a4', '#f08a8a', '#e6c07a', '#7fb1e3',
  ]),
  void: preset('void', 'Void', 'dark', [
    '#131313', '#121212', '#1b1b1b', '#2a2a2a', 'rgba(255,255,255,0.10)',
    '#e2e2e2', '#a0a0a0', '#8c9195',
    '#b1cad7', '#cde6f4', '#90d792', '#ffb4ab', '#e6bfa4', '#b1cad7',
  ]),
  nord: preset('nord', 'Nord', 'dark', [
    '#2e3440', '#2b303b', '#3b4252', '#434c5e', 'rgba(216,222,233,0.12)',
    '#eceff4', '#d8dee9', '#94a1b5',
    '#88c0d0', '#a3d4e0', '#a3be8c', '#bf616a', '#ebcb8b', '#81a1c1',
  ]),
  light: preset('light', 'Light', 'light', [
    '#ffffff', '#f6f7f9', '#f0f2f5', '#e6e9ee', 'rgba(0,0,0,0.12)',
    '#1f2328', '#4a5159', '#6b7280',
    '#2f73d8', '#1b5fc4', '#2da66a', '#d23f3f', '#b7791f', '#2f73d8',
  ]),
};

export const DEFAULT_PRESET = 'graphite';

export const MARKDOWN_FIELDS: MarkdownField[] = [
  { key: 'heading', label: 'Headings', cssVar: '--md-heading' },
  { key: 'text', label: 'Body text', cssVar: '--md-text' },
  { key: 'bold', label: 'Bold', cssVar: '--md-bold' },
  { key: 'link', label: 'Links & wikilinks', cssVar: '--md-link' },
  { key: 'code', label: 'Inline code', cssVar: '--md-code' },
  { key: 'codeBg', label: 'Inline code background', cssVar: '--md-code-bg' },
  { key: 'quote', label: 'Quote text', cssVar: '--md-quote' },
  { key: 'quoteBorder', label: 'Quote border', cssVar: '--md-quote-border' },
];

export const DEFAULT_APPEARANCE: Appearance = { preset: DEFAULT_PRESET, markdownOverrides: {} };

export function normalizeAppearance(value: unknown): Appearance {
  if (!value || typeof value !== 'object') return DEFAULT_APPEARANCE;
  const candidate = value as Partial<Appearance>;
  const presetId = typeof candidate.preset === 'string' && PRESETS[candidate.preset]
    ? candidate.preset
    : DEFAULT_PRESET;
  const overrides: Record<string, string> = {};
  if (candidate.markdownOverrides && typeof candidate.markdownOverrides === 'object') {
    for (const field of MARKDOWN_FIELDS) {
      const color = candidate.markdownOverrides[field.key];
      if (typeof color === 'string' && HEX_COLOR.test(color)) overrides[field.key] = color.toLowerCase();
    }
  }
  return { preset: presetId, markdownOverrides: overrides };
}

export function applyTheme(appearance: Appearance): void {
  const themePreset = PRESETS[appearance.preset] ?? PRESETS[DEFAULT_PRESET];
  const root = document.documentElement;

  for (const [key, value] of Object.entries(themePreset.tokens)) {
    root.style.setProperty(key, value);
  }
  root.style.setProperty('color-scheme', themePreset.colorScheme);
  root.setAttribute('data-theme', themePreset.colorScheme);

  for (const field of MARKDOWN_FIELDS) {
    const override = appearance.markdownOverrides[field.key];
    if (override) root.style.setProperty(field.cssVar, override);
    else root.style.removeProperty(field.cssVar);
  }
}

/** Resolve a CSS variable's current computed value to a #rrggbb hex (for color inputs). */
export function readVarHex(cssVar: string): string {
  const probe = document.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = `position:fixed;pointer-events:none;opacity:0;color:var(${cssVar})`;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return toHex(resolved);
}

export function toHex(color: string): string {
  if (!color) return '#000000';
  if (color.startsWith('#')) {
    if (color.length === 4) return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
    return color.slice(0, 7);
  }
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (match) {
    const [r, g, b] = match[1].split(',').map((n) => parseFloat(n));
    const hex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }
  const srgb = color.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (srgb) {
    const channels = srgb.slice(1, 4).map((channel) => Number(channel) * 255);
    const hex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return `#${channels.map(hex).join('')}`;
  }
  return '#000000';
}

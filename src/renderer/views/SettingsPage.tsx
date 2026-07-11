import { ChevronDown, Keyboard, ListTree, RotateCcw, Settings2, Sparkles, SwatchBook } from 'lucide-react';
import changelog from '../../../CHANGELOG.md?raw';
import MDXPreview from '../components/MDXPreview';
import { Button } from '../components/ui/button';
import { Switch } from '../components/ui/switch';
import { cn } from '../lib/utils';
import {
  MARKDOWN_FIELDS,
  PRESETS,
  readVarHex,
  type Appearance,
} from '../lib/theme';
import { DEFAULT_BINDINGS, KEY_ACTIONS, eventToChord, formatChord, type Bindings } from '../lib/keybindings';

// The bundled CHANGELOG, rendered on demand so Settings stays light.
function WhatsNewSection() {
  const [open, setOpen] = useState(false);
  const version = changelog.match(/## \[([^\]]+)\]/)?.[1] ?? '';

  return (
    <section aria-labelledby="whatsnew-heading" className="border-t border-[var(--divider)] pt-8 mt-8">
      <div className="mb-2 flex items-start justify-between gap-4">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 h-4 w-4 text-[var(--accent-strong)]" />
          <div>
            <h2 id="whatsnew-heading" className="text-sm font-semibold text-[var(--ink)]">What's new{version ? ` — v${version}` : ''}</h2>
            <p className="mt-0.5 text-xs leading-5 text-[var(--ink-muted)]">The release notes that ship with this build.</p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
          {open ? 'Hide' : 'Show'} changelog
        </Button>
      </div>
      {open && (
        <div className="mt-4 overflow-hidden rounded-lg border border-[var(--divider)]">
          <MDXPreview mdxContent={changelog} />
        </div>
      )}
    </section>
  );
}

export interface PropertiesSettings { removeEmpty: boolean; showInReading: boolean; collapsedByDefault: boolean }

interface SettingsPageProps {
  appearance: Appearance;
  onAppearanceChange: (appearance: Appearance) => void;
  bindings: Bindings;
  onBindingsChange: (bindings: Bindings) => void;
  properties: PropertiesSettings;
  onPropertiesChange: (properties: PropertiesSettings) => void;
}

const PROPERTY_TOGGLES: { key: keyof PropertiesSettings; label: string; hint: string }[] = [
  { key: 'showInReading', label: 'Show properties in reading view', hint: 'Render the properties panel above the rendered note.' },
  { key: 'collapsedByDefault', label: 'Collapse properties by default', hint: 'Start each note with the properties panel collapsed.' },
  { key: 'removeEmpty', label: 'Remove empty frontmatter', hint: 'Delete the frontmatter block automatically when the last property is removed.' },
];

function PropertiesSection({ properties, onPropertiesChange }: { properties: PropertiesSettings; onPropertiesChange: (p: PropertiesSettings) => void }) {
  return (
    <section aria-labelledby="properties-heading" className="border-t border-[var(--divider)] pt-8">
      <div className="mb-4 flex items-start gap-2">
        <ListTree className="mt-0.5 h-4 w-4 text-[var(--accent-strong)]" />
        <div>
          <h2 id="properties-heading" className="text-sm font-semibold text-[var(--ink)]">Document properties</h2>
          <p className="mt-0.5 text-xs leading-5 text-[var(--ink-muted)]">How YAML frontmatter is shown and edited as a properties panel.</p>
        </div>
      </div>
      <div className="divide-y divide-[var(--divider)] border-y border-[var(--divider)]">
        {PROPERTY_TOGGLES.map(({ key, label, hint }) => (
          <div key={key} className="grid min-h-[52px] grid-cols-[1fr_auto] items-center gap-4 py-2.5">
            <label htmlFor={`prop-${key}`} className="text-sm text-[var(--ink-secondary)]">
              {label}
              <span className="mt-0.5 block text-xs text-[var(--ink-muted)]">{hint}</span>
            </label>
            <Switch id={`prop-${key}`} checked={properties[key]} onCheckedChange={(v) => onPropertiesChange({ ...properties, [key]: v })} />
          </div>
        ))}
      </div>
    </section>
  );
}

function KeybindingsSection({ bindings, onBindingsChange }: { bindings: Bindings; onBindingsChange: (b: Bindings) => void }) {
  const [capturing, setCapturing] = useState<string | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation(); // don't let the captured combo also fire its action
      if (e.key === 'Escape') { setCapturing(null); return; }
      const chord = eventToChord(e);
      if (!chord) return; // wait for a non-modifier key
      onBindingsChange({ ...bindings, [capturing]: chord });
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, bindings, onBindingsChange]);

  const isDefault = JSON.stringify(bindings) === JSON.stringify(DEFAULT_BINDINGS);

  return (
    <section aria-labelledby="keys-heading" className="border-t border-[var(--divider)] pt-8">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex items-start gap-2">
          <Keyboard className="mt-0.5 h-4 w-4 text-[var(--accent-strong)]" />
          <div>
            <h2 id="keys-heading" className="text-sm font-semibold text-[var(--ink)]">Keyboard shortcuts</h2>
            <p className="mt-0.5 text-xs leading-5 text-[var(--ink-muted)]">Click a shortcut, then press the new key combination. Esc cancels.</p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={isDefault} onClick={() => onBindingsChange({ ...DEFAULT_BINDINGS })}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
        </Button>
      </div>

      <div className="divide-y divide-[var(--divider)] border-y border-[var(--divider)]">
        {KEY_ACTIONS.map((action) => (
          <div key={action.id} className="grid min-h-[48px] grid-cols-[1fr_auto] items-center gap-4 py-2">
            <span className="text-sm text-[var(--ink-secondary)]">{action.label}</span>
            <button
              type="button"
              onClick={() => setCapturing(action.id)}
              className={cn(
                'interactive min-w-[7rem] rounded-md border px-3 py-1.5 text-center font-mono text-xs',
                capturing === action.id
                  ? 'border-[var(--accent)] bg-[color-mix(in_oklch,var(--accent)_12%,var(--surface))] text-[var(--accent-strong)]'
                  : 'border-[var(--divider)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-hover)]',
              )}
            >
              {capturing === action.id ? 'Press keys…' : formatChord(bindings[action.id] ?? action.default)}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function ThemeSwatches({ presetId }: { presetId: string }) {
  const theme = PRESETS[presetId];
  const colors = [theme.tokens['--canvas'], theme.tokens['--surface'], theme.tokens['--ink'], theme.tokens['--accent']];
  return (
    <span className="flex overflow-hidden rounded-sm border border-[var(--divider)]" aria-hidden="true">
      {colors.map((color, index) => <span key={`${color}-${index}`} className="h-4 w-5" style={{ backgroundColor: color }} />)}
    </span>
  );
}

export default function SettingsPage({ appearance, onAppearanceChange, bindings, onBindingsChange, properties, onPropertiesChange }: SettingsPageProps) {
  const [resolvedColors, setResolvedColors] = useState<Record<string, string>>({});

  useLayoutEffect(() => {
    setResolvedColors(Object.fromEntries(MARKDOWN_FIELDS.map((field) => [field.key, readVarHex(field.cssVar)])));
  }, [appearance]);

  const selectPreset = (preset: string) => onAppearanceChange({ ...appearance, preset });

  const setMarkdownColor = (key: string, value: string) => {
    onAppearanceChange({
      ...appearance,
      markdownOverrides: { ...appearance.markdownOverrides, [key]: value.toLowerCase() },
    });
  };

  const resetMarkdownColor = (key: string) => {
    const markdownOverrides = { ...appearance.markdownOverrides };
    delete markdownOverrides[key];
    onAppearanceChange({ ...appearance, markdownOverrides });
  };

  const resetAllMarkdownColors = () => onAppearanceChange({ ...appearance, markdownOverrides: {} });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-7 pb-12 pt-7">
        <header className="mb-8 flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--divider)] bg-[var(--surface)] text-[var(--accent-strong)]">
            <Settings2 className="h-4 w-4" />
          </span>
          <div>
            <h1 className="text-base font-semibold tracking-[-0.01em] text-[var(--ink)]">Settings</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--ink-secondary)]">Choose how Neuron looks and tune Markdown colors for long-form reading.</p>
          </div>
        </header>

        <section aria-labelledby="appearance-heading" className="border-b border-[var(--divider)] pb-8">
          <div className="mb-4 flex items-center gap-2">
            <SwatchBook className="h-4 w-4 text-[var(--accent-strong)]" />
            <div>
              <h2 id="appearance-heading" className="text-sm font-semibold text-[var(--ink)]">Appearance</h2>
              <p className="mt-0.5 text-xs leading-5 text-[var(--ink-muted)]">Presets update the whole workspace immediately.</p>
            </div>
          </div>

          <div role="group" aria-label="Application theme" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {Object.values(PRESETS).map((preset) => {
              const selected = appearance.preset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => selectPreset(preset.id)}
                  className={cn(
                    'interactive flex min-h-[72px] flex-col items-start justify-between rounded-md border p-3 text-left',
                    selected
                      ? 'border-[var(--accent)] bg-[color-mix(in_oklch,var(--accent)_10%,var(--surface))]'
                      : 'border-[var(--divider)] bg-[var(--surface)] hover:bg-[var(--surface-hover)]',
                  )}
                >
                  <ThemeSwatches presetId={preset.id} />
                  <span className="flex w-full items-center justify-between gap-2 text-xs font-medium text-[var(--ink)]">
                    {preset.label}
                    {selected && <span className="font-mono text-[10px] text-[var(--accent-strong)]">Active</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="markdown-heading" className="pt-8">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 id="markdown-heading" className="text-sm font-semibold text-[var(--ink)]">Markdown colors</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">These colors stay in sync across the live editor and reading view.</p>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={Object.keys(appearance.markdownOverrides).length === 0} onClick={resetAllMarkdownColors}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset to preset defaults
            </Button>
          </div>

          <div className="divide-y divide-[var(--divider)] border-y border-[var(--divider)]">
            {MARKDOWN_FIELDS.map((field) => {
              const overridden = Boolean(appearance.markdownOverrides[field.key]);
              const value = appearance.markdownOverrides[field.key] ?? resolvedColors[field.key] ?? '#000000';
              return (
                <div key={field.key} className="grid min-h-[54px] grid-cols-[minmax(10rem,1fr)_auto] items-center gap-4 py-2.5">
                  <label htmlFor={`markdown-${field.key}`} className="text-sm text-[var(--ink-secondary)]">{field.label}</label>
                  <div className="flex items-center gap-2">
                    <input
                      id={`markdown-${field.key}`}
                      type="color"
                      value={value}
                      onChange={(event) => setMarkdownColor(field.key, event.target.value)}
                      className="h-8 w-10 cursor-pointer rounded border border-[var(--divider)] bg-[var(--surface)] p-1"
                      aria-label={`${field.label} color`}
                    />
                    <code className="w-[4.75rem] text-right font-mono text-[11px] tabular-nums text-[var(--ink-muted)]">{value.toUpperCase()}</code>
                    <Button type="button" variant="ghost" size="icon" disabled={!overridden} onClick={() => resetMarkdownColor(field.key)} aria-label={`Reset ${field.label.toLowerCase()}`} title={`Reset ${field.label.toLowerCase()}`}>
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <PropertiesSection properties={properties} onPropertiesChange={onPropertiesChange} />

        <KeybindingsSection bindings={bindings} onBindingsChange={onBindingsChange} />

        <WhatsNewSection />
      </div>
    </div>
  );
}
import { useEffect, useLayoutEffect, useState } from 'react';

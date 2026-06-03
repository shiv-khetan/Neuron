import { RotateCcw, Settings2, SwatchBook } from 'lucide-react';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';
import {
  MARKDOWN_FIELDS,
  PRESETS,
  readVarHex,
  type Appearance,
} from '../lib/theme';

interface SettingsPageProps {
  appearance: Appearance;
  onAppearanceChange: (appearance: Appearance) => void;
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

export default function SettingsPage({ appearance, onAppearanceChange }: SettingsPageProps) {
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
      </div>
    </div>
  );
}
import { useLayoutEffect, useState } from 'react';

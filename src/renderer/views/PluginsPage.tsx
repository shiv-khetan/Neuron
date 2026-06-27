import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Plug, PencilRuler, LayoutGrid, Search, PackagePlus, ShieldCheck, PanelRight, PanelBottom, TerminalSquare } from 'lucide-react';
import { usePlugins } from '../plugins/host';
import type { PluginCategory, PluginManifest } from '../plugins/types';
import { Input } from '../components/ui/input';
import { Switch } from '../components/ui/switch';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { ScrollArea } from '../components/ui/scroll-area';
import { cn } from '../lib/utils';

const categoryMeta: Record<PluginCategory, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  ai: { label: 'AI', icon: Sparkles },
  integration: { label: 'Integrations', icon: Plug },
  editor: { label: 'Editor', icon: PencilRuler },
  view: { label: 'Views', icon: LayoutGrid },
};

function ConfigForm({ manifest }: { manifest: PluginManifest }) {
  const { getConfig, setConfig } = usePlugins();
  const [values, setValues] = useState<Record<string, string>>(getConfig(manifest.id));
  useEffect(() => setValues(getConfig(manifest.id)), [manifest.id, getConfig]);
  if (!manifest.configSchema?.length) return null;
  const save = () => setConfig(manifest.id, values);
  return (
    <div className="mt-3 space-y-3 border-t border-[var(--divider)] pt-3">
      {manifest.configSchema.map((field) => (
        <div key={field.key} className="space-y-1">
          <label className="text-[11px] font-medium text-[var(--ink-secondary)]" htmlFor={`${manifest.id}-${field.key}`}>{field.label}</label>
          <Input
            id={`${manifest.id}-${field.key}`}
            type={field.type === 'password' ? 'password' : 'text'}
            placeholder={field.placeholder}
            value={values[field.key] ?? ''}
            onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
            onBlur={save}
          />
          {field.description && <p className="text-[10px] leading-4 text-[var(--ink-muted)]">{field.description}</p>}
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={save}>Save settings</Button>
    </div>
  );
}

function PluginRow({
  manifest,
  onOpenSidePanel,
  onOpenBottomPanel,
}: {
  manifest: PluginManifest;
  onOpenSidePanel: () => void;
  onOpenBottomPanel: () => void;
}) {
  const { isEnabled, setEnabled, getConfig, panels, commands } = usePlugins();
  const enabled = isEnabled(manifest.id);
  const meta = categoryMeta[manifest.category];
  const Icon = meta.icon;
  const myPanels = panels.filter((p) => p.pluginId === manifest.id);
  const sidePanels = myPanels.filter((p) => (p.view.location ?? 'side') === 'side');
  const bottomPanels = myPanels.filter((p) => p.view.location === 'bottom');
  const myCommands = commands.filter((c) => c.pluginId === manifest.id);
  const needsConfig = enabled && !!manifest.configSchema?.length && Object.keys(getConfig(manifest.id)).length === 0;

  return (
    <div className={cn('rounded-md border p-4', enabled ? 'border-[color-mix(in_oklch,var(--accent)_34%,var(--divider))] bg-[var(--surface)]' : 'border-[var(--divider)] bg-[var(--canvas)]')}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--divider)] bg-[var(--surface)] text-[var(--accent-strong)]">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--ink)]">{manifest.name}</h3>
            <Badge variant="outline">{meta.label}</Badge>
            {enabled && (needsConfig
              ? <Badge variant="warning">Needs configuration</Badge>
              : <Badge variant="default">Enabled</Badge>)}
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-secondary)]">{manifest.description}</p>
          <p className="mt-1 font-mono text-[10px] text-[var(--ink-muted)]">v{manifest.version}{manifest.author ? ` · ${manifest.author}` : ''}</p>
          {enabled && (myPanels.length > 0 || myCommands.length > 0) && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[var(--ink-muted)]">
              {sidePanels.length > 0 && <span className="flex items-center gap-1"><PanelRight className="h-3 w-3" /> {sidePanels.map((p) => p.view.title).join(', ')}</span>}
              {bottomPanels.length > 0 && <span className="flex items-center gap-1"><PanelBottom className="h-3 w-3" /> {bottomPanels.map((p) => p.view.title).join(', ')}</span>}
              {myCommands.length > 0 && <span className="flex items-center gap-1"><TerminalSquare className="h-3 w-3" /> {myCommands.map((c) => c.command.title).join(', ')}</span>}
            </div>
          )}
          {enabled && (sidePanels.length > 0 || bottomPanels.length > 0) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {sidePanels.length > 0 && <Button size="sm" variant="outline" onClick={onOpenSidePanel}><PanelRight className="h-3.5 w-3.5" /> Open side peek</Button>}
              {bottomPanels.length > 0 && <Button size="sm" variant="outline" onClick={onOpenBottomPanel}><PanelBottom className="h-3.5 w-3.5" /> Open bottom peek</Button>}
            </div>
          )}
        </div>
        <Switch checked={enabled} onCheckedChange={(on) => setEnabled(manifest.id, on)} aria-label={`Enable ${manifest.name}`} />
      </div>
      {enabled && <ConfigForm manifest={manifest} />}
    </div>
  );
}

export default function PluginsPage({ onOpenSidePanel, onOpenBottomPanel }: { onOpenSidePanel: () => void; onOpenBottomPanel: () => void }) {
  const { plugins } = usePlugins();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<PluginCategory | 'all'>('all');

  const presentCategories = useMemo(() => Array.from(new Set(plugins.map((p) => p.category))), [plugins]);
  const filtered = plugins.filter((p) => {
    const matchesCategory = category === 'all' || p.category === category;
    const q = query.trim().toLowerCase();
    const matchesQuery = !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
    return matchesCategory && matchesQuery;
  });

  return (
    <div className="canvas-surface flex h-full w-full flex-col">
      <header className="border-b divider-color px-6 py-4">
        <h1 className="text-base font-semibold tracking-[-0.01em] text-[var(--ink)]">Integrations & Plugins</h1>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--ink-secondary)]">
          <ShieldCheck className="h-3.5 w-3.5 text-[var(--accent-strong)]" />
          Keys are stored locally and AI calls run through the desktop app — your notes and credentials never ship in the bundle.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-muted)]" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search plugins" className="pl-8" />
          </label>
          <div className="flex items-center gap-1">
            <button onClick={() => setCategory('all')} className={cn('tag-button interactive px-2.5 text-xs', category === 'all' && 'border-[var(--accent)] bg-[var(--accent)] text-[var(--canvas)]')}>All</button>
            {presentCategories.map((c) => (
              <button key={c} onClick={() => setCategory(c)} className={cn('tag-button interactive px-2.5 text-xs', category === c && 'border-[var(--accent)] bg-[var(--accent)] text-[var(--canvas)]')}>{categoryMeta[c].label}</button>
            ))}
          </div>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-3xl space-y-3 p-6">
          {filtered.map((manifest) => <PluginRow key={manifest.id} manifest={manifest} onOpenSidePanel={onOpenSidePanel} onOpenBottomPanel={onOpenBottomPanel} />)}
          {filtered.length === 0 && <p className="py-12 text-center text-sm text-[var(--ink-muted)]">No plugins match your search.</p>}

          <div className="rounded-md border border-dashed border-[var(--divider)] p-4">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--divider)] bg-[var(--surface)] text-[var(--ink-muted)]">
                <PackagePlus className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-[var(--ink)]">Add a custom plugin</h3>
                <p className="mt-1 text-xs leading-5 text-[var(--ink-secondary)]">Drop a plugin folder into the workspace to extend Neuron with your own panels, commands, and components. Folder-loaded plugins are coming soon.</p>
              </div>
              <Button size="sm" variant="outline" disabled>Coming soon</Button>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

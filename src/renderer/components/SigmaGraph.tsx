import { useEffect, useRef, useState } from 'react';
import Sigma from 'sigma';
import { LocateFixed, RotateCcw, Search, Settings2, X } from 'lucide-react';
import { type GraphNode, type GraphEdge, KnowledgeGraph, GRAPH_DEFAULTS, GRAPH_RANGES, graphPreferences, seedPositions, type GraphPreferences, type Positions } from '../lib/knowledge-graph';
import { settleLayout } from '../lib/graph-layout';
import type { GraphCanvasProps } from './GraphCanvas';

const labels = { gravity: 'Centre / gravity', repel: 'Repel', attraction: 'Link attraction', distance: 'Link distance', nodeSize: 'Node size', linkThickness: 'Link thickness', labelThreshold: 'Label fade threshold', depth: 'Local depth' };
const duration = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 320;
const readColors = () => {
  const style = getComputedStyle(document.documentElement);
  const get = (key: string) => style.getPropertyValue(key).trim();
  return { accent: get('--accent'), ink: get('--ink'), muted: get('--ink-muted'), faint: get('--surface-hover'), edge: get('--divider') };
};

export default function SigmaGraph(props: GraphCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const model = useRef(new KnowledgeGraph());
  // Carries the same attribute types as the graph it renders. Bare `Sigma`
  // defaults its generics to graphology's open `Attributes`, which does not
  // accept the typed node/edge payloads the reducers below read -- so the ref
  // and the instance it holds disagreed.
  const renderer = useRef<Sigma<GraphNode, GraphEdge> | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const userNavigated = useRef(false);
  const positions = useRef<Positions>(Object.create(null));
  const latest = useRef(props); latest.current = props;
  const pref = useRef<GraphPreferences>({ ...GRAPH_DEFAULTS });
  const [preferences, setPreferences] = useState(pref.current);
  const [key, setKey] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const hovered = useRef<string | null>(null);
  const relatedNodes = useRef(new Set<string>());
  const filter = useRef<Set<string> | null>(null);
  const queryRef = useRef(''); queryRef.current = query || props.searchQuery || '';
  const colors = useRef(readColors());

  const save = () => {
    if (!key || (!model.current.graph.order && Object.keys(positions.current).length)) return;
    const saved: Positions = Object.create(null);
    model.current.graph.forEachNode((id, a) => { saved[id] = { x: a.x, y: a.y }; });
    positions.current = saved;
    void window.electronAPI.settings.set(key, { preferences: pref.current, positions: saved }).then(result => {
      if (!result.success) setError('Could not save connection settings.');
    }).catch(() => setError('Could not save connection settings.'));
  };
  const saveRef = useRef(save); saveRef.current = save;
  const reheat = (movable?: Set<string>) => {
    stop.current?.();
    setRunning(true);
    try {
      stop.current = settleLayout(model.current, pref.current, () => { setRunning(false); saveRef.current(); }, movable);
    } catch {
      setRunning(false);
      setError('Layout could not start. Saved positions are still available.');
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const repo = await window.electronAPI.getNotesDirectory();
      const storageKey = `graph:v1:${repo ?? ''}`;
      const stored = await window.electronAPI.settings.get<{ preferences?: unknown; positions?: Positions }>(storageKey);
      if (cancelled) return;
      pref.current = graphPreferences(stored?.preferences);
      setPreferences(pref.current);
      positions.current = Object.create(null);
      if (stored?.positions && typeof stored.positions === 'object') {
        for (const [id, point] of Object.entries(stored.positions)) {
          if (point && Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) < 1e9 && Math.abs(point.y) < 1e9) positions.current[id] = { x: point.x, y: point.y };
        }
      }
      setKey(storageKey);
    })().catch(() => { if (!cancelled) setError('Could not load connection settings.'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!key || !host.current) return;
    const graph = model.current.graph;
    let sigma: Sigma<GraphNode, GraphEdge>;
    try {
    sigma = new Sigma(graph, host.current, {
      allowInvalidContainer: true, stagePadding: 30, labelSize: 11, labelDensity: props.compact ? 0.3 : 0.7,
      labelRenderedSizeThreshold: 0, minCameraRatio: 0.03, maxCameraRatio: 8,
      labelFont: getComputedStyle(document.body).fontFamily,
      defaultDrawNodeLabel: (ctx, data, settings) => {
        if (!data.label) return;
        const ratio = sigma.getCamera().ratio;
        const alpha = data.forceLabel ? 1 : Math.max(0, Math.min(1, (pref.current.labelThreshold - ratio) * 3 + 0.5));
        if (!alpha) return;
        ctx.globalAlpha = alpha; ctx.fillStyle = colors.current.ink;
        ctx.font = `${settings.labelSize}px ${settings.labelFont}`;
        ctx.fillText(data.label, data.x + data.size + 3, data.y + 4); ctx.globalAlpha = 1;
      },
      nodeReducer: (id, attrs) => {
        const p = pref.current;
        const active = id === latest.current.selectedNote;
        const related = !hovered.current || relatedNodes.current.has(id);
        const matches = !queryRef.current || attrs.label.toLowerCase().includes(queryRef.current.toLowerCase());
        return { ...attrs, size: p.nodeSize + Math.min(7, Math.sqrt(attrs.degree) * 1.2) + (active ? 2 : 0),
          color: !related || !matches ? colors.current.faint : active ? colors.current.accent : colors.current.muted,
          label: attrs.kind === 'unresolved' ? `${attrs.label} (missing)` : attrs.label,
          forceLabel: active || id === hovered.current,
          hidden: (!!filter.current && !filter.current.has(id)) || (!p.orphans && attrs.degree === 0) || (!p.unresolved && attrs.kind === 'unresolved'),
          highlighted: active,
        };
      },
      edgeReducer: (id, attrs) => {
        const [a, b] = graph.extremities(id);
        return { ...attrs, type: pref.current.arrows ? 'arrow' : 'line', size: pref.current.linkThickness,
          color: hovered.current && a !== hovered.current && b !== hovered.current ? colors.current.faint : colors.current.edge };
      },
    });
    } catch {
      setError('Connections could not start. WebGL is unavailable.');
      return;
    }
    renderer.current = sigma;
    // Read-only inspection of the real renderer for development and Electron QA.
    if (import.meta.env.DEV) Object.defineProperty(host.current, 'sigma', { value: sigma, configurable: true });
    let dragged: string | null = null;
    let moved = false;
    sigma.on('enterNode', ({ node }) => { hovered.current = node; relatedNodes.current = new Set([node, ...model.current.neighbours(node)]); sigma.refresh(); });
    sigma.on('leaveNode', () => { hovered.current = null; sigma.refresh(); });
    sigma.on('clickNode', ({ node }) => { if (!moved && graph.getNodeAttribute(node, 'kind') !== 'unresolved') latest.current.onSelectNote(node); });
    sigma.on('downStage', () => { userNavigated.current = true; });
    sigma.getMouseCaptor().on('wheel', () => { userNavigated.current = true; });
    sigma.on('downNode', ({ node }) => {
      userNavigated.current = true; stop.current?.(); dragged = node; moved = false;
      graph.setNodeAttribute(node, 'fixed', true); sigma.setCustomBBox(sigma.getBBox());
    });
    sigma.getMouseCaptor().on('mousemovebody', event => {
      if (!dragged) return;
      moved = true; graph.mergeNodeAttributes(dragged, { ...sigma.viewportToGraph(event) });
      event.preventSigmaDefault(); event.original.preventDefault(); event.original.stopPropagation();
    });
    const release = () => {
      if (!dragged) return;
      graph.setNodeAttribute(dragged, 'fixed', false); dragged = null;
      if (moved) reheat();
    };
    sigma.getMouseCaptor().on('mouseup', release);
    window.addEventListener('blur', release);
    const observer = new MutationObserver(() => { colors.current = readColors(); sigma.refresh(); });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    return () => {
      stop.current?.(); saveRef.current(); observer.disconnect(); window.removeEventListener('blur', release);
      sigma.kill(); renderer.current = null;
    };
  }, [key]);

  useEffect(() => {
    if (!key || !renderer.current) return;
    stop.current?.();
    model.current.graph.forEachNode((id, a) => { positions.current[id] = { x: a.x, y: a.y }; });
    const changed = model.current.sync(props.notesData);
    const added = seedPositions(model.current, positions.current);
    renderer.current.refresh();
    if (added.length) reheat(added.length === model.current.graph.order ? undefined : new Set(added));
    if (changed) setRevision(r => r + 1);
  }, [props.notesData, key]);

  useEffect(() => {
    const g = model.current.graph;
    filter.current = (preferences.local || props.scope === 'active')
      ? model.current.local(props.selectedNote ?? '', preferences.depth)
      : props.scope === 'folder' ? new Set(g.nodes().filter(id => id.startsWith(props.folder ?? ''))) : null;
    renderer.current?.refresh();
  }, [preferences, props.selectedNote, props.scope, props.folder, revision, query, props.searchQuery]);

  const focus = (id: string) => {
    const sigma = renderer.current;
    if (!sigma || !model.current.graph.hasNode(id)) return;
    sigma.refresh(); const point = sigma.getNodeDisplayData(id);
    if (point) void sigma.getCamera().animate({ x: point.x, y: point.y }, { duration: duration() });
  };
  useEffect(() => {
    userNavigated.current = false;
    if (props.selectedNote) focus(props.selectedNote);
  }, [props.selectedNote, key]);
  useEffect(() => {
    if (!running && !userNavigated.current && props.selectedNote) focus(props.selectedNote);
  }, [revision, running]);

  const update = (next: GraphPreferences, physics = false) => {
    pref.current = next; setPreferences(next); renderer.current?.refresh();
    if (physics) reheat(); else saveRef.current();
  };
  const fit = () => {
    const sigma = renderer.current;
    if (!sigma) return;
    userNavigated.current = true; sigma.setCustomBBox(null); sigma.refresh();
    const nodes = model.current.graph.nodes().map(id => sigma.getNodeDisplayData(id)).filter(n => n && !n.hidden);
    if (!nodes.length) return;
    const xs = nodes.map(n => n!.x), ys = nodes.map(n => n!.y);
    const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
    void sigma.getCamera().animate({ x: (xmin + xmax) / 2, y: (ymin + ymax) / 2, ratio: Math.max(0.1, xmax - xmin, ymax - ymin) }, { duration: duration() });
  };
  const matches = model.current.graph.nodes().filter(id => model.current.graph.getNodeAttribute(id, 'kind') !== 'unresolved' && model.current.graph.getNodeAttribute(id, 'label').toLowerCase().includes(query.toLowerCase()));

  return <div className="relative h-full min-h-0 text-[var(--ink)]" data-graph-root data-layout-running={running}>
    <div ref={host} data-graph-canvas className="absolute inset-0" role="img" aria-label={`${model.current.graph.order} nodes in workspace connections`} />
    <div className="absolute left-1.5 top-1.5 flex gap-0.5">
      <button className="tool-button bg-[var(--surface)]" aria-label="Fit connections" title="Fit connections" onClick={fit}><LocateFixed size={14} /></button>
      <button className="tool-button bg-[var(--surface)]" aria-label="Search nodes" title="Search nodes" onClick={() => { setSearching(s => !s); setQuery(''); }}><Search size={14} /></button>
      <button className="tool-button bg-[var(--surface)]" aria-label="Connection settings" title="Connection settings" onClick={() => dialog.current?.showModal()}><Settings2 size={14} /></button>
    </div>
    {searching && <div className="absolute inset-x-2 top-10 max-h-[180px] overflow-auto rounded border border-[var(--divider)] bg-[var(--surface)] p-2 text-xs">
      <input autoFocus aria-label="Find a node" placeholder="Find a note…" value={query} onChange={e => setQuery(e.target.value)} className="w-full bg-transparent p-1" onKeyDown={e => { if (e.key === 'Escape') { setSearching(false); setQuery(''); } }} />
      {matches.slice(0, 30).map(id => <button key={id} className="block w-full truncate rounded p-1 text-left hover:bg-[var(--surface-hover)]" aria-label={`Open ${model.current.graph.getNodeAttribute(id, 'label')}`} onClick={() => { latest.current.onSelectNote(id); focus(id); setSearching(false); setQuery(''); }}>{model.current.graph.getNodeAttribute(id, 'label')}</button>)}
      {!matches.length && <p role="status">No matching notes.</p>}
    </div>}
    {!model.current.graph.order && key && <p className="pointer-events-none absolute inset-x-4 top-1/2 text-center text-xs text-[var(--ink-muted)]">{props.emptyHint ?? 'Add notes and links to see connections.'}</p>}
    {error && <p role="alert" className="absolute bottom-2 inset-x-2 bg-[var(--surface)] text-xs">{error}</p>}
    <dialog ref={dialog} aria-label="Connection settings" className="m-auto w-[320px] max-w-[90vw] max-h-[85vh] overflow-auto rounded-lg border border-[var(--divider)] bg-[var(--surface)] p-4 text-xs text-[var(--ink)] backdrop:bg-black/40">
      <div className="mb-3 flex items-center justify-between"><strong>Connections</strong><button className="tool-button" aria-label="Close connection settings" onClick={() => dialog.current?.close()}><X size={14} /></button></div>
      <div className="segmented mb-3" role="group" aria-label="Connection scope">{[false, true].map(local => <button key={String(local)} aria-pressed={preferences.local === local} onClick={() => update({ ...preferences, local })}>{local ? 'Local' : 'Global'}</button>)}</div>
      {(Object.keys(GRAPH_RANGES) as (keyof typeof GRAPH_RANGES)[]).map(name => <label key={name} className="mb-3 block">{labels[name]} <output className="float-right tabular-nums">{preferences[name]}</output><input className="mt-1 block w-full accent-[var(--accent)]" type="range" aria-label={labels[name]} min={GRAPH_RANGES[name][0]} max={GRAPH_RANGES[name][1]} step={GRAPH_RANGES[name][2]} value={preferences[name]} onChange={e => update({ ...preferences, [name]: Number(e.target.value) }, ['gravity', 'repel', 'attraction', 'distance'].includes(name))} /></label>)}
      {(['arrows', 'orphans', 'unresolved'] as const).map(name => <label key={name} className="mb-2 flex items-center gap-2"><input type="checkbox" checked={preferences[name]} onChange={e => update({ ...preferences, [name]: e.target.checked })} />{{ arrows: 'Show arrows', orphans: 'Show unlinked notes', unresolved: 'Show missing links' }[name]}</label>)}
      <button className="mt-2 flex items-center gap-2 tool-button !w-auto px-2" onClick={() => { stop.current?.(); positions.current = Object.create(null); seedPositions(model.current, positions.current); renderer.current?.setCustomBBox(null); reheat(); }}><RotateCcw size={14} />Reset layout</button>
      <p className="mt-3 text-[var(--ink-muted)]">Drag a node to arrange it. Positions save after settling.</p>
    </dialog>
  </div>;
}

import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, Code2, ExternalLink, FileText, FileWarning, Folder, FolderOpen, Globe, Plus, Trash2, Zap } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { MAX_DEPTH, MAX_NODES, safeUrl } from '@/lib/view-security';
import { registerSurface, type SurfaceProps } from './index';

// ===========================================================================
// .vw views are authored in HTML with Tailwind classes. Standard tags render
// as themselves (className passed through); a handful of custom tags map to
// app components. Per the product's "minimal visual containers, not nested
// cards" principle, blocks are flat — a subtle surface tint, no border/shadow.
// ===========================================================================

// Lets any block open a note in the editor (wired to the app's onSelectNote).
const ViewNav = React.createContext<(notePath: string) => void>(() => {});

// One broken block (bad attributes, malformed CSV, renderer bug) renders an
// inline error instead of crashing the whole view.
class Block extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <p className="text-sm text-[var(--danger)]">This block failed to render.</p>
      : this.props.children;
  }
}

const attrs = (el: Element): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) out[a.name.toLowerCase()] = a.value;
  return out;
};

// A flat block: faint surface tint, rounded, no outline. Replaces the old Card.
// h-full so tiles fill their grid cell — bento rows stay flush.
function Tile({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="h-full rounded-lg bg-[var(--surface)] p-4">
      {title ? <div className="mb-2 text-xs font-medium text-[var(--ink-muted)]">{title}</div> : null}
      {children}
    </div>
  );
}

function Metric({ title, value, hint }: { title?: string; value?: string; hint?: string }) {
  return (
    <Tile title={title}>
      <div className="text-3xl font-semibold tracking-tight text-[var(--ink)]">{value ?? '—'}</div>
      {hint ? <p className="mt-1 text-xs text-[var(--ink-muted)]">{hint}</p> : null}
    </Tile>
  );
}

function useSource(request: { type: string; glob?: string; limit?: number }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof window.electronAPI.views.source>> | null>(null);
  useEffect(() => {
    let alive = true;
    void window.electronAPI.views.source(request).then((r) => { if (alive) setData(r); });
    return () => { alive = false; };
  }, [JSON.stringify(request)]);
  return data;
}

const Loading = () => <p className="text-sm text-[var(--ink-muted)]">Loading…</p>;
const Err = ({ msg }: { msg?: string }) => <p className="text-sm text-[var(--danger)]">{msg}</p>;

function FileCount({ title, glob }: { title?: string; glob?: string }) {
  const data = useSource({ type: 'fileCount', glob });
  return (
    <Tile title={title ?? 'File count'}>
      {!data ? <Loading /> : !data.success ? <Err msg={data.error} /> : (
        <>
          <div className="text-3xl font-semibold tracking-tight text-[var(--ink)]">{data.count ?? 0}</div>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">{glob ? `Matching ${glob}` : 'Files in this workspace'}</p>
        </>
      )}
    </Tile>
  );
}

function FileGraph({ title, glob }: { title?: string; glob?: string }) {
  const data = useSource({ type: 'fileCount', glob });
  const rows = Object.entries(data?.byExtension ?? {}).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  return (
    <Tile title={title ?? 'Files by type'}>
      {!data ? <Loading /> : !data.success ? <Err msg={data.error} /> : (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows}>
              <CartesianGrid stroke="var(--divider)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: 'var(--ink-muted)', fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fill: 'var(--ink-muted)', fontSize: 11 }} />
              <Tooltip cursor={{ fill: 'rgba(127,127,127,0.10)' }} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--divider)', borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="value" fill="var(--accent)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Tile>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function FileTable({ title, glob, limit }: { title?: string; glob?: string; limit?: string }) {
  const data = useSource({ type: 'fileTable', glob, limit: limit ? Number(limit) : undefined });
  return (
    <Tile title={title ?? 'Files'}>
      {!data ? <Loading /> : !data.success ? <Err msg={data.error} /> : (
        <div className="overflow-auto">
          <table className="vw-table">
            <thead>
              <tr><th>Path</th><th>Type</th><th>Size</th><th>Modified</th></tr>
            </thead>
            <tbody>
              {(data.rows ?? []).map((row) => (
                <tr key={row.path}>
                  <td className="font-mono text-[var(--ink)]">{row.path}</td>
                  <td><span className="vw-chip">{row.extension}</span></td>
                  <td>{formatBytes(row.size)}</td>
                  <td>{new Date(row.modified).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Tile>
  );
}

// Serialize a header + rows back to CSV (quote fields with commas/quotes/newlines).
function toCsv(columns: string[], rows: string[][]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [columns, ...rows].map((r) => r.map((c) => esc(c ?? '')).join(',')).join('\n') + '\n';
}

// A fully editable, Notion-style database backed by a referenced CSV. Edits,
// added/removed rows, and added columns are written straight back to the file.
function CsvTable({ src, title }: { src?: string; title?: string }) {
  const [columns, setColumns] = useState<string[] | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);

  useEffect(() => {
    let alive = true;
    if (!src) { setError('Add a "src" attribute pointing at a .csv file.'); return; }
    void window.electronAPI.views.csv(src).then((r) => {
      if (!alive) return;
      if (!r.success) { setError(r.error ?? 'Could not read CSV.'); return; }
      setColumns(r.columns ?? []); setRows(r.rows ?? []); setError(null);
    });
    return () => { alive = false; };
  }, [src]);

  const save = useCallback((cols: string[], rws: string[][]) => {
    if (src) void window.electronAPI.writeNote(src, toCsv(cols, rws));
  }, [src]);

  const commit = () => save(columns ?? [], rows);
  const editCell = (ri: number, ci: number, v: string) => setRows((p) => { const n = p.map((r) => [...r]); n[ri][ci] = v; return n; });
  const editHeader = (ci: number, v: string) => setColumns((p) => { const n = [...(p ?? [])]; n[ci] = v; return n; });
  const addRow = () => { const n = [...rows, (columns ?? []).map(() => '')]; setRows(n); save(columns ?? [], n); };
  const deleteRow = (ri: number) => { const n = rows.filter((_, i) => i !== ri); setRows(n); save(columns ?? [], n); };
  const addColumn = () => {
    const cols = [...(columns ?? []), `Column ${(columns?.length ?? 0) + 1}`];
    const rws = rows.map((r) => [...r, '']);
    setColumns(cols); setRows(rws); save(cols, rws);
  };
  const doSort = (ci: number) => {
    const dir: 1 | -1 = sort && sort.col === ci && sort.dir === 1 ? -1 : 1;
    const sorted = [...rows].sort((a, b) => {
      const x = a[ci] ?? '', y = b[ci] ?? '';
      const nx = Number(x), ny = Number(y);
      const cmp = x !== '' && y !== '' && !Number.isNaN(nx) && !Number.isNaN(ny) ? nx - ny : x.localeCompare(y);
      return cmp * dir;
    });
    setRows(sorted); setSort({ col: ci, dir });
  };

  if (error) return <section className="space-y-2">{title ? <div className="vw-label">{title}</div> : null}<Err msg={error} /></section>;
  if (!columns) return <section className="space-y-2">{title ? <div className="vw-label">{title}</div> : null}<Loading /></section>;

  return (
    <section className="space-y-2">
      {title ? <div className="vw-label">{title}</div> : null}
      <div className="overflow-auto">
        <table className="vw-db">
          <thead>
            <tr>
              <th className="vw-db-gutter" />
              {columns.map((col, ci) => (
                <th key={ci} className="group/h">
                  <div className="flex items-center gap-1">
                    <input className="vw-cell font-medium text-[var(--ink-muted)]" value={col} onChange={(e) => editHeader(ci, e.target.value)} onBlur={commit} aria-label={`Column ${ci + 1} name`} />
                    <button type="button" className="vw-icon-btn opacity-0 group-hover/h:opacity-100" onClick={() => doSort(ci)} title="Sort" aria-label={`Sort by ${col}`}>
                      {sort?.col === ci ? (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ChevronsUpDown className="h-3 w-3" />}
                    </button>
                  </div>
                </th>
              ))}
              <th className="vw-db-gutter">
                <button type="button" className="vw-icon-btn" onClick={addColumn} title="Add column" aria-label="Add column"><Plus className="h-3.5 w-3.5" /></button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="group/r">
                <td className="vw-db-gutter">
                  <button type="button" className="vw-icon-btn opacity-0 group-hover/r:opacity-100 hover:text-[var(--danger)]" onClick={() => deleteRow(ri)} title="Delete row" aria-label={`Delete row ${ri + 1}`}><Trash2 className="h-3.5 w-3.5" /></button>
                </td>
                {columns.map((_, ci) => (
                  <td key={ci}>
                    <input className="vw-cell" value={row[ci] ?? ''} onChange={(e) => editCell(ri, ci, e.target.value)} onBlur={commit} aria-label={`${columns[ci]} for row ${ri + 1}`} />
                  </td>
                ))}
                <td className="vw-db-gutter" />
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="vw-newrow" onClick={addRow}><Plus className="h-3.5 w-3.5" /> New row</button>
      </div>
    </section>
  );
}

interface Automation { name: string; commands: string[] }

function ActionButton({ label, action, automation, path, content, hint }: { label?: string; action?: string; automation?: string; path?: string; content?: string; hint?: string }) {
  const [state, setState] = useState('');
  const openNote = React.useContext(ViewNav);
  const Icon = automation ? Zap : action === 'openInVSCode' ? Code2 : action === 'reveal' ? FolderOpen : action === 'open' || action === 'createFile' ? FileText : ExternalLink;

  const run = async () => {
    if (action === 'open') {
      if (path) openNote(path); else setState('Missing path');
      return;
    }
    if (action === 'createFile') {
      if (!path) { setState('Missing path'); return; }
      const r = await window.electronAPI.views.action({ type: 'createFile', path, content });
      if (r.success) openNote(path); else setState(r.error ?? 'Could not create file');
      return;
    }
    if (automation) {
      const saved = await window.electronAPI.settings.get<Automation[]>('automations');
      const found = Array.isArray(saved) ? saved.find((a) => a.name === automation) : undefined;
      if (!found) { setState(`No automation named “${automation}”. Create it in the Automations panel.`); return; }
      setState('Running…');
      for (const cmd of found.commands) {
        const r = await window.electronAPI.terminal.run(cmd);
        if (!r.success) { setState(`Failed at: ${cmd}`); return; }
      }
      setState('Done');
      return;
    }
    if (!action) { setState('Missing action'); return; }
    setState('Running…');
    const r = await window.electronAPI.views.action({ type: action, path });
    setState(r.success ? 'Done' : r.error ?? 'Action failed');
  };

  return (
    <div>
      <Button onClick={run}><Icon className="h-4 w-4" />{label ?? (automation ?? 'Run')}</Button>
      {hint ? <p className="mt-1 text-xs text-[var(--ink-muted)]">{hint}</p> : null}
      {state ? <p className="mt-1 text-xs text-[var(--ink-muted)]">{state}</p> : null}
    </div>
  );
}

function TaskRow({ checked, children, id }: { checked?: boolean; children: React.ReactNode; id: string }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 py-1 text-sm text-[var(--ink-secondary)]">
      <Checkbox id={id} defaultChecked={checked} />
      <span>{children}</span>
    </label>
  );
}

// --- Habit-tracker visuals -------------------------------------------------

// Labeled progress bar (e.g. "Daily Drivers · 1/5 complete · 20%").
function Progress({ label, value, max }: { label?: string; value?: string; max?: string }) {
  const v = Number(value ?? 0);
  const m = Number(max ?? 100) || 1;
  const pct = Math.max(0, Math.min(100, Math.round((v / m) * 100)));
  return (
    <Tile title={label}>
      <div className="mb-1.5 flex items-baseline justify-between text-xs text-[var(--ink-muted)]">
        <span>{max ? `${v} / ${m} complete` : 'Progress'}</span>
        <span className="font-medium text-[var(--ink)]">{pct}%</span>
      </div>
      <div className="vw-progress-track"><div className="vw-progress-fill" style={{ width: `${pct}%` }} /></div>
    </Tile>
  );
}

// Metric tile with a colored delta (e.g. "7,370" + "+34 vs yesterday").
function Stat({ label, value, delta, sub }: { label?: string; value?: string; delta?: string; sub?: string }) {
  const dir = delta?.trim().startsWith('-') ? 'down' : delta?.trim().startsWith('+') ? 'up' : 'flat';
  const deltaColor = dir === 'up' ? 'text-[var(--accent-strong)]' : dir === 'down' ? 'text-[var(--danger)]' : 'text-[var(--ink-muted)]';
  return (
    <Tile>
      {label ? <div className="text-[0.7rem] font-medium uppercase tracking-wide text-[var(--ink-muted)]">{label}</div> : null}
      <div className="mt-1 text-3xl font-semibold tracking-tight text-[var(--ink)]">{value ?? '—'}</div>
      {delta ? <div className={`mt-1 text-xs font-medium ${deltaColor}`}>{delta}</div> : null}
      {sub ? <div className="mt-0.5 text-xs text-[var(--ink-muted)]">{sub}</div> : null}
    </Tile>
  );
}

// Shared loader: inline `data` JSON wins; otherwise pull rows from a CSV.
function useChartData(src?: string, dataAttr?: string, x?: string, y?: string) {
  const [points, setPoints] = useState<{ name: string; value: number }[] | null>(dataAttr ? null : null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (dataAttr) {
      try {
        const parsed = JSON.parse(dataAttr) as { name?: string; label?: string; value?: number }[];
        setPoints(parsed.map((d) => ({ name: String(d.name ?? d.label ?? ''), value: Number(d.value ?? 0) })));
      } catch { setError('Invalid inline data JSON.'); }
      return;
    }
    if (!src) { setError('Add a "src" CSV or inline "data".'); return; }
    void window.electronAPI.views.csv(src).then((r) => {
      if (!alive) return;
      if (!r.success) { setError(r.error ?? 'Could not read CSV.'); return; }
      const cols = r.columns ?? [];
      const xi = x ? cols.indexOf(x) : 0;
      const yi = y ? cols.indexOf(y) : 1;
      setPoints((r.rows ?? []).map((row) => ({ name: row[xi] ?? '', value: Number(row[yi] ?? 0) })));
    });
    return () => { alive = false; };
  }, [src, dataAttr, x, y]);
  return { points, error };
}

function Chart({ kind, title, src, data, x, y }: { kind: 'bar' | 'line' | 'area'; title?: string; src?: string; data?: string; x?: string; y?: string }) {
  const { points, error } = useChartData(src, data, x, y);
  const axis = { tick: { fill: 'var(--ink-muted)', fontSize: 11 }, stroke: 'var(--divider)' };
  const tip = { contentStyle: { background: 'var(--surface)', border: '1px solid var(--divider)', borderRadius: 8, fontSize: 12 }, cursor: { fill: 'rgba(127,127,127,0.10)', stroke: 'var(--divider)' } };
  return (
    <Tile title={title ?? 'Chart'}>
      {error ? <Err msg={error} /> : !points ? <Loading /> : (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            {kind === 'line' ? (
              <LineChart data={points}>
                <CartesianGrid stroke="var(--divider)" vertical={false} />
                <XAxis dataKey="name" {...axis} /><YAxis allowDecimals={false} {...axis} /><Tooltip {...tip} />
                <Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} dot={false} />
              </LineChart>
            ) : kind === 'area' ? (
              <AreaChart data={points}>
                <defs><linearGradient id="vwArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--accent)" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke="var(--divider)" vertical={false} />
                <XAxis dataKey="name" {...axis} /><YAxis allowDecimals={false} {...axis} /><Tooltip {...tip} />
                <Area type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} fill="url(#vwArea)" />
              </AreaChart>
            ) : (
              <BarChart data={points}>
                <CartesianGrid stroke="var(--divider)" vertical={false} />
                <XAxis dataKey="name" {...axis} /><YAxis allowDecimals={false} {...axis} /><Tooltip {...tip} />
                <Bar dataKey="value" fill="var(--accent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </Tile>
  );
}

// GitHub-style contribution grid for habit streaks: a date,value CSV → cells
// colored by intensity. Shows the most recent ~18 weeks.
function Heatmap({ title, src, date, value }: { title?: string; src?: string; date?: string; value?: string }) {
  const [cells, setCells] = useState<{ date: string; value: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!src) { setError('Add a "src" attribute pointing at a date/value .csv.'); return; }
    void window.electronAPI.views.csv(src).then((r) => {
      if (!alive) return;
      if (!r.success) { setError(r.error ?? 'Could not read CSV.'); return; }
      const cols = r.columns ?? [];
      const di = date ? cols.indexOf(date) : 0;
      const vi = value ? cols.indexOf(value) : 1;
      setCells((r.rows ?? []).map((row) => ({ date: row[di] ?? '', value: Number(row[vi] ?? 0) })));
    });
    return () => { alive = false; };
  }, [src, date, value]);

  const { weeks, max } = useMemo(() => {
    const byDate = new Map((cells ?? []).map((c) => [c.date, c.value]));
    const max = Math.max(1, ...(cells ?? []).map((c) => c.value));
    const days = 18 * 7;
    const today = new Date();
    const start = new Date(today); start.setDate(today.getDate() - (days - 1));
    start.setDate(start.getDate() - start.getDay()); // align to Sunday
    const weeks: { date: string; value: number }[][] = [];
    for (let w = 0; w * 7 < days + 7; w++) {
      const col: { date: string; value: number }[] = [];
      for (let d = 0; d < 7; d++) {
        const cur = new Date(start); cur.setDate(start.getDate() + w * 7 + d);
        if (cur > today) break;
        const iso = cur.toISOString().slice(0, 10);
        col.push({ date: iso, value: byDate.get(iso) ?? 0 });
      }
      if (col.length) weeks.push(col);
    }
    return { weeks, max };
  }, [cells]);

  const level = (v: number) => (v <= 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4)));

  return (
    <Tile title={title ?? 'Habit streak'}>
      {error ? <Err msg={error} /> : !cells ? <Loading /> : (
        <div className="vw-heatmap">
          {weeks.map((col, wi) => (
            <div key={wi} className="vw-heatmap-col">
              {col.map((cell) => (
                <div key={cell.date} className="vw-heatmap-cell" data-level={level(cell.value)} title={`${cell.date}: ${cell.value}`} />
              ))}
            </div>
          ))}
        </div>
      )}
    </Tile>
  );
}

// --- File & link blocks ----------------------------------------------------

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);
const NOTE_EXT = new Set(['md', 'mdx', 'vw', 'db', 'canvas', 'csv']);
const ext = (p: string) => p.split('.').pop()?.toLowerCase() ?? '';
const norm = (p: string) => p.replace(/\\/g, '/');

// A link card. ponytail: favicon + hand-written title only; a real OG-metadata
// unfurl needs a network fetch — add one if hand-authored cards fall short.
function Bookmark({ url, title, description }: { url?: string; title?: string; description?: string }) {
  const href = safeUrl(url) ?? undefined;
  let host = '';
  try { host = new URL(href ?? '').hostname; } catch { /* show raw url */ }
  return (
    <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg bg-[var(--surface)] p-3 hover:bg-[var(--surface-hover)]">
      {host
        ? <img src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`} alt="" className="h-8 w-8 shrink-0 rounded" />
        : <Globe className="h-8 w-8 shrink-0 text-[var(--ink-muted)]" />}
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-[var(--ink)]">{title ?? host ?? url}</div>
        {description ? <div className="truncate text-xs text-[var(--ink-secondary)]">{description}</div> : null}
        <div className="truncate text-[11px] text-[var(--ink-muted)]">{host || url}</div>
      </div>
    </a>
  );
}

// Grid of workspace images. Files are matched by glob (or all images).
function Gallery({ title, glob, limit }: { title?: string; glob?: string; limit?: string }) {
  const data = useSource({ type: 'fileTable', glob, limit: limit ? Number(limit) : 60 });
  const [urls, setUrls] = useState<Record<string, string>>({});
  const images = (data?.rows ?? []).filter((r) => IMAGE_EXT.has(ext(r.path)));
  useEffect(() => {
    for (const row of images) {
      if (urls[row.path]) continue;
      void window.electronAPI.views.file(row.path).then((r) => {
        if (r.success && r.dataUrl) setUrls((p) => ({ ...p, [row.path]: r.dataUrl! }));
      });
    }
  }, [data]);
  return (
    <Tile title={title ?? 'Gallery'}>
      {!data ? <Loading /> : !data.success ? <Err msg={data.error} /> : images.length === 0 ? (
        <p className="text-sm text-[var(--ink-muted)]">No images{glob ? ` matching ${glob}` : ''} in this workspace.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {images.map((row) => (
            <figure key={row.path} className="overflow-hidden rounded-md bg-[var(--canvas)]">
              {urls[row.path] ? <img src={urls[row.path]} alt={row.path} className="aspect-square w-full object-cover" /> : <div className="aspect-square w-full" />}
              <figcaption className="truncate px-1.5 py-1 text-[11px] text-[var(--ink-muted)]">{norm(row.path).split('/').pop()}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </Tile>
  );
}

// Flat clickable file list. Notes open in the editor.
function ListView({ title, glob, limit }: { title?: string; glob?: string; limit?: string }) {
  const data = useSource({ type: 'fileTable', glob, limit: limit ? Number(limit) : 100 });
  const open = React.useContext(ViewNav);
  return (
    <Tile title={title ?? 'Files'}>
      {!data ? <Loading /> : !data.success ? <Err msg={data.error} /> : (
        <ul>
          {(data.rows ?? []).map((row) => (
            <li key={row.path}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] disabled:cursor-default disabled:hover:bg-transparent"
                disabled={!NOTE_EXT.has(ext(row.path))}
                onClick={() => open(row.path)}
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" />
                <span className="truncate">{norm(row.path).split('/').pop()}</span>
                <span className="ml-auto truncate font-mono text-[11px] text-[var(--ink-muted)]">{norm(row.path)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}

// Files grouped by folder, each note clickable.
function FolderView({ title, path: root }: { title?: string; path?: string }) {
  const data = useSource({ type: 'fileTable', glob: root ? `${root}/*` : undefined, limit: 500 });
  const open = React.useContext(ViewNav);
  const groups = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const row of data?.rows ?? []) {
      const p = norm(row.path);
      const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '/';
      if (!out.has(dir)) out.set(dir, []);
      out.get(dir)!.push(p);
    }
    return [...out.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data]);
  return (
    <Tile title={title ?? 'Folders'}>
      {!data ? <Loading /> : !data.success ? <Err msg={data.error} /> : groups.map(([dir, files]) => (
        <div key={dir} className="mb-2">
          <div className="flex items-center gap-1.5 py-1 text-xs font-medium text-[var(--ink-muted)]">
            <Folder className="h-3.5 w-3.5" /> {dir}
          </div>
          {files.map((p) => (
            <button
              key={p}
              type="button"
              className="flex w-full items-center gap-2 rounded px-1.5 py-0.5 pl-6 text-left text-sm text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] disabled:cursor-default disabled:hover:bg-transparent"
              disabled={!NOTE_EXT.has(ext(p))}
              onClick={() => open(p)}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" />
              <span className="truncate">{p.split('/').pop()}</span>
            </button>
          ))}
        </div>
      ))}
    </Tile>
  );
}

// Tags that map to app components. Everything else renders as a native element
// with its Tailwind classes passed through.
const COMPONENTS: Record<string, (a: Record<string, string>, children: React.ReactNode, key: string) => React.ReactNode> = {
  metric: (a, _c, k) => <Metric key={k} title={a.title} value={a.value} hint={a.hint} />,
  filecount: (a, _c, k) => <FileCount key={k} title={a.title} glob={a.glob} />,
  graph: (a, _c, k) => <FileGraph key={k} title={a.title} glob={a.glob} />,
  filegraph: (a, _c, k) => <FileGraph key={k} title={a.title} glob={a.glob} />,
  filetable: (a, _c, k) => <FileTable key={k} title={a.title} glob={a.glob} limit={a.limit} />,
  csvtable: (a, _c, k) => <CsvTable key={k} src={a.src} title={a.title} />,
  database: (a, _c, k) => <CsvTable key={k} src={a.src} title={a.title} />,
  progress: (a, _c, k) => <Progress key={k} label={a.label ?? a.title} value={a.value} max={a.max} />,
  stat: (a, _c, k) => <Stat key={k} label={a.label ?? a.title} value={a.value} delta={a.delta} sub={a.sub} />,
  barchart: (a, _c, k) => <Chart key={k} kind="bar" title={a.title} src={a.src} data={a.data} x={a.x} y={a.y} />,
  linechart: (a, _c, k) => <Chart key={k} kind="line" title={a.title} src={a.src} data={a.data} x={a.x} y={a.y} />,
  areachart: (a, _c, k) => <Chart key={k} kind="area" title={a.title} src={a.src} data={a.data} x={a.x} y={a.y} />,
  heatmap: (a, _c, k) => <Heatmap key={k} title={a.title} src={a.src} date={a.date} value={a.value} />,
  bookmark: (a, _c, k) => <Bookmark key={k} url={a.url ?? a.href} title={a.title} description={a.description} />,
  linkpreview: (a, _c, k) => <Bookmark key={k} url={a.url ?? a.href} title={a.title} description={a.description} />,
  gallery: (a, _c, k) => <Gallery key={k} title={a.title} glob={a.glob} limit={a.limit} />,
  listview: (a, _c, k) => <ListView key={k} title={a.title} glob={a.glob} limit={a.limit} />,
  folderview: (a, _c, k) => <FolderView key={k} title={a.title} path={a.path} />,
  card: (a, c, k) => <Tile key={k} title={a.title}>{c}</Tile>,
  task: (a, c, k) => <TaskRow key={k} id={`task-${k}`} checked={a.checked !== undefined && a.checked !== 'false'}>{c}</TaskRow>,
  action: (a, _c, k) => <ActionButton key={k} label={a.label} action={a.action ?? a.run} automation={a.automation} path={a.path} content={a.content} hint={a.hint} />,
};

// Native tags we allow; anything else (script/style/iframe/…) is dropped.
const NATIVE = new Set(['div', 'section', 'header', 'footer', 'main', 'article', 'aside', 'nav', 'span', 'p', 'a', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'hr', 'br', 'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'label', 'button']);

function toReact(node: ChildNode, key: string, budget: { n: number }, depth: number): React.ReactNode {
  // Hard limits: a runaway or hostile document degrades, never hangs the app.
  if (++budget.n > MAX_NODES || depth > MAX_DEPTH) return null;
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const a = attrs(el);
  const children = Array.from(el.childNodes).map((c, i) => toReact(c, `${key}.${i}`, budget, depth + 1));

  if (tag === 'button' && (a.action || a.run || a.automation)) return COMPONENTS.action(a, null, key);
  const custom = COMPONENTS[tag];
  if (custom) {
    const block = <Block key={key}>{custom(a, children, `${key}c`)}</Block>;
    // class on a view tag places it on the parent grid (col-span, row-span, …).
    return a.class ? <div key={key} className={a.class}>{block}</div> : block;
  }

  if (!NATIVE.has(tag)) return <React.Fragment key={key}>{children}</React.Fragment>;
  const props: Record<string, unknown> = { key, className: a.class };
  if (tag === 'a') { props.href = safeUrl(a.href) ?? undefined; props.target = '_blank'; props.rel = 'noreferrer'; }
  if (tag === 'img') { props.src = safeUrl(a.src) ?? undefined; props.alt = a.alt ?? ''; }
  if (tag === 'br' || tag === 'hr' || tag === 'img') return React.createElement(tag, props);
  return React.createElement(tag, props, children.length ? children : undefined);
}

// HTML doesn't self-close custom/unknown tags, so `<metric ... />` stays open
// and swallows every following sibling as its children (which we then drop).
// Rewrite `<tag ... />` to `<tag ...></tag>` first. Quoted attribute values are
// skipped so a literal `/>` inside a value can't trigger a false close; void
// elements like <br/> tolerate the explicit close.
function closeSelfClosingTags(html: string): string {
  return html.replace(/<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)\/>/g, '<$1$2></$1>');
}

export function ViewSurface({ content, onSelectNote }: SurfaceProps) {
  const tree = useMemo(() => {
    const text = content.trim();
    if (!text) return null;
    try {
      const doc = new DOMParser().parseFromString(closeSelfClosingTags(text), 'text/html');
      const budget = { n: 0 };
      const nodes = Array.from(doc.body.childNodes).map((n, i) => toReact(n, `n${i}`, budget, 0));
      if (budget.n > MAX_NODES) nodes.push(<p key="overflow" className="text-sm text-[var(--danger)]">View truncated: more than {MAX_NODES} nodes.</p>);
      return nodes;
    } catch {
      return null;
    }
  }, [content]);

  if (!tree) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-[var(--ink-muted)]">
        <FileWarning className="h-5 w-5" />
        This view is empty. Write HTML with Tailwind classes and view tags like &lt;metric&gt;, &lt;csvtable&gt;, &lt;filegraph&gt;.
      </div>
    );
  }

  return (
    <ViewNav.Provider value={onSelectNote}>
      <main className="font-sans h-full overflow-auto bg-[var(--canvas)] text-[var(--ink)]">
        <div className="mx-auto max-w-6xl px-6 py-6 vw-content">{tree}</div>
      </main>
    </ViewNav.Provider>
  );
}

registerSurface('vw', ViewSurface);

export default ViewSurface;

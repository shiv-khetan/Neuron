import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, FilePlus2, FileText, Frame, Globe, Link2, Maximize, StickyNote, Trash2 } from 'lucide-react';
import { safeUrl, withinDocBudget } from '@/lib/view-security';
import { registerSurface, type SurfaceProps } from './index';

// ===========================================================================
// .canvas files use the open JSON Canvas format (the same one Obsidian uses):
// { nodes: [...], edges: [...] } where nodes are text cards, file cards, link
// cards, or groups with x/y/width/height/color, and edges connect node sides
// with optional labels and colors. Files written here open in Obsidian and
// vice versa. Same persistence pattern as the .db surface: every gesture
// serializes back to the file (atomic write); the watcher folds in external
// edits live.
// ===========================================================================

type Side = 'top' | 'right' | 'bottom' | 'left';

interface CanvasNode {
  id: string;
  type: 'text' | 'file' | 'link' | 'group';
  x: number; y: number; width: number; height: number;
  color?: string;
  text?: string;   // text nodes
  file?: string;   // file nodes (workspace-relative path)
  url?: string;    // link nodes
  label?: string;  // groups
}
interface CanvasEdge {
  id: string;
  fromNode: string; toNode: string;
  fromSide?: Side; toSide?: Side;
  color?: string; label?: string;
}
interface CanvasDoc { nodes: CanvasNode[]; edges: CanvasEdge[] }

const uid = () => Math.random().toString(36).slice(2, 9);

// JSON Canvas preset colors "1".."6"; anything else is treated as a CSS color.
const PRESET: Record<string, string> = { '1': '#dd5c5c', '2': '#e28f44', '3': '#d9b23c', '4': '#5aa06c', '5': '#45a3a3', '6': '#9a6dd7' };
const colorOf = (c?: string) => (c ? PRESET[c] ?? c : undefined);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);
const ext = (p: string) => p.split('.').pop()?.toLowerCase() ?? '';

function tryParse(text: string): CanvasDoc | null {
  if (!text.trim()) return { nodes: [], edges: [] };
  if (!withinDocBudget(text)) return null;
  try {
    const raw = JSON.parse(text) as Partial<CanvasDoc>;
    if (!raw || typeof raw !== 'object') return null;
    return { nodes: Array.isArray(raw.nodes) ? raw.nodes : [], edges: Array.isArray(raw.edges) ? raw.edges : [] };
  } catch {
    return null;
  }
}

const anchor = (n: CanvasNode, side: Side) => side === 'top' ? { x: n.x + n.width / 2, y: n.y }
  : side === 'bottom' ? { x: n.x + n.width / 2, y: n.y + n.height }
  : side === 'left' ? { x: n.x, y: n.y + n.height / 2 }
  : { x: n.x + n.width, y: n.y + n.height / 2 };

const NORMAL: Record<Side, { x: number; y: number }> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

// Pick facing sides for an edge whose sides weren't stored.
function autoSides(a: CanvasNode, b: CanvasNode): [Side, Side] {
  const dx = (b.x + b.width / 2) - (a.x + a.width / 2);
  const dy = (b.y + b.height / 2) - (a.y + a.height / 2);
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? ['right', 'left'] : ['left', 'right']) : (dy > 0 ? ['bottom', 'top'] : ['top', 'bottom']);
}

function sideForPoint(n: CanvasNode, p: { x: number; y: number }): Side {
  const dx = (p.x - (n.x + n.width / 2)) / n.width;
  const dy = (p.y - (n.y + n.height / 2)) / n.height;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top');
}

function edgePath(from: { x: number; y: number }, fromSide: Side, to: { x: number; y: number }, toSide: Side): string {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const k = Math.max(40, dist / 3);
  const c1 = { x: from.x + NORMAL[fromSide].x * k, y: from.y + NORMAL[fromSide].y * k };
  const c2 = { x: to.x + NORMAL[toSide].x * k, y: to.y + NORMAL[toSide].y * k };
  return `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`;
}

type Gesture =
  | { kind: 'pan'; startClient: { x: number; y: number }; startPan: { x: number; y: number } }
  | { kind: 'move'; origins: Map<string, { x: number; y: number }>; startWorld: { x: number; y: number }; moved: boolean }
  | { kind: 'resize'; id: string; origin: { x: number; y: number; width: number; height: number }; startWorld: { x: number; y: number } }
  | { kind: 'connect'; fromNode: string; fromSide: Side };

type Selection = { type: 'node' | 'edge'; id: string } | null;

export function CanvasSurface({ path, content, notesData, onSelectNote }: SurfaceProps) {
  const [doc, setDocState] = useState<CanvasDoc>({ nodes: [], edges: [] });
  const [invalid, setInvalid] = useState(false);
  const [pan, setPan] = useState({ x: 80, y: 80 });
  const [zoom, setZoom] = useState(1);
  const [selection, setSelection] = useState<Selection>(null);
  const [editing, setEditing] = useState<string | null>(null); // node id being text-edited
  const [connectCursor, setConnectCursor] = useState<{ x: number; y: number } | null>(null);
  const [addNoteOpen, setAddNoteOpen] = useState(false);
  const [addLinkOpen, setAddLinkOpen] = useState(false);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});

  const containerRef = useRef<HTMLDivElement>(null);
  const docRef = useRef(doc);
  const panRef = useRef(pan); panRef.current = pan;
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const gestureRef = useRef<Gesture | null>(null);
  const lastWritten = useRef<string | null>(null);

  const adopt = (next: CanvasDoc) => { docRef.current = next; setDocState(next); };
  const stage = adopt;
  const write = (next: CanvasDoc) => {
    adopt(next);
    const text = JSON.stringify(next, null, '\t') + '\n'; // Obsidian writes tab-indented canvases
    lastWritten.current = text;
    void window.electronAPI.writeNote(path, text);
  };
  const flush = () => write(docRef.current);
  const d = () => docRef.current;

  // Adopt file content (initial open, Source-mode edits, our own echo excluded).
  useEffect(() => {
    if (content === lastWritten.current) return;
    const parsed = tryParse(content);
    setInvalid(!parsed);
    if (parsed) adopt(parsed);
  }, [content]);

  // External edits (Obsidian, git, scripts) land live via the workspace watcher.
  useEffect(() => {
    return window.electronAPI.onNotesChanged((event, changed) => {
      if (changed !== path || event === 'unlink') return;
      void window.electronAPI.readNote(path).then((text) => {
        if (text.startsWith('Error:') || text === lastWritten.current) return;
        const parsed = tryParse(text);
        if (parsed) { adopt(parsed); setInvalid(false); }
      });
    });
  }, [path]);

  // Load workspace images referenced by file nodes.
  useEffect(() => {
    for (const n of doc.nodes) {
      if (n.type !== 'file' || !n.file || !IMAGE_EXT.has(ext(n.file)) || imageUrls[n.file]) continue;
      void window.electronAPI.views.file(n.file).then((r) => {
        if (r.success && r.dataUrl) setImageUrls((p) => ({ ...p, [n.file!]: r.dataUrl! }));
      });
    }
  }, [doc]);

  const worldFromClient = (cx: number, cy: number) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: (cx - rect.left - panRef.current.x) / zoomRef.current, y: (cy - rect.top - panRef.current.y) / zoomRef.current };
  };

  // --- Mutations -------------------------------------------------------------
  const patchNode = (id: string, patch: Partial<CanvasNode>, commit = true) => {
    const next = { ...d(), nodes: d().nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
    (commit ? write : stage)(next);
  };
  const patchEdge = (id: string, patch: Partial<CanvasEdge>, commit = true) => {
    const next = { ...d(), edges: d().edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) };
    (commit ? write : stage)(next);
  };
  const addNode = (node: Omit<CanvasNode, 'id'>) => {
    const id = uid();
    write({ ...d(), nodes: [...d().nodes, { id, ...node }] });
    setSelection({ type: 'node', id });
    return id;
  };
  const deleteSelection = () => {
    if (!selection) return;
    if (selection.type === 'edge') { write({ ...d(), edges: d().edges.filter((e) => e.id !== selection.id) }); }
    else write({ ...d(), nodes: d().nodes.filter((n) => n.id !== selection.id), edges: d().edges.filter((e) => e.fromNode !== selection.id && e.toNode !== selection.id) });
    setSelection(null);
    setEditing(null);
  };
  const setColor = (color?: string) => {
    if (!selection) return;
    if (selection.type === 'node') patchNode(selection.id, { color });
    else patchEdge(selection.id, { color });
  };

  // Turn a temporary text card into a permanent note beside the canvas file.
  const convertToNote = async (node: CanvasNode) => {
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
    const first = (node.text ?? '').split('\n')[0].replace(/^#+\s*/, '').trim() || 'Card';
    const slug = first.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'card';
    let notePath = `${folder}${slug}.md`;
    let i = 2;
    while (d().nodes.some((n) => n.file === notePath) || notesData.some((n) => n.path === notePath)) notePath = `${folder}${slug}-${i++}.md`;
    const r = await window.electronAPI.writeNote(notePath, node.text ?? '');
    if (r.success) patchNode(node.id, { type: 'file', file: notePath, text: undefined });
  };

  // --- Viewport --------------------------------------------------------------
  const zoomFit = () => {
    const el = containerRef.current;
    const nodes = d().nodes;
    if (!el || nodes.length === 0) { setPan({ x: 80, y: 80 }); setZoom(1); return; }
    const minX = Math.min(...nodes.map((n) => n.x)), minY = Math.min(...nodes.map((n) => n.y));
    const maxX = Math.max(...nodes.map((n) => n.x + n.width)), maxY = Math.max(...nodes.map((n) => n.y + n.height));
    const rect = el.getBoundingClientRect();
    const z = Math.min(rect.width / (maxX - minX + 120), rect.height / (maxY - minY + 120), 1.5);
    setZoom(z);
    setPan({ x: (rect.width - (maxX - minX) * z) / 2 - minX * z, y: (rect.height - (maxY - minY) * z) / 2 - minY * z });
  };

  const onWheel = (e: React.WheelEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const next = Math.min(4, Math.max(0.1, zoomRef.current * Math.exp(-e.deltaY * 0.0015)));
    const wx = (e.clientX - rect.left - panRef.current.x) / zoomRef.current;
    const wy = (e.clientY - rect.top - panRef.current.y) / zoomRef.current;
    setZoom(next);
    setPan({ x: e.clientX - rect.left - wx * next, y: e.clientY - rect.top - wy * next });
  };

  // --- Gestures (window-level listeners live for the duration of a drag) ------
  const beginGesture = (g: Gesture) => {
    gestureRef.current = g;
    const move = (e: PointerEvent) => {
      const cur = gestureRef.current;
      if (!cur) return;
      if (cur.kind === 'pan') {
        setPan({ x: cur.startPan.x + e.clientX - cur.startClient.x, y: cur.startPan.y + e.clientY - cur.startClient.y });
        return;
      }
      const w = worldFromClient(e.clientX, e.clientY);
      if (cur.kind === 'move') {
        cur.moved = true;
        const dx = w.x - cur.startWorld.x, dy = w.y - cur.startWorld.y;
        stage({ ...d(), nodes: d().nodes.map((n) => { const o = cur.origins.get(n.id); return o ? { ...n, x: Math.round(o.x + dx), y: Math.round(o.y + dy) } : n; }) });
      } else if (cur.kind === 'resize') {
        const dx = w.x - cur.startWorld.x, dy = w.y - cur.startWorld.y;
        patchNode(cur.id, { width: Math.max(80, Math.round(cur.origin.width + dx)), height: Math.max(60, Math.round(cur.origin.height + dy)) }, false);
      } else if (cur.kind === 'connect') {
        setConnectCursor(w);
      }
    };
    const up = (e: PointerEvent) => {
      const cur = gestureRef.current;
      gestureRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setConnectCursor(null);
      if (!cur) return;
      if (cur.kind === 'move' || cur.kind === 'resize') { if (cur.kind !== 'move' || cur.moved) flush(); return; }
      if (cur.kind === 'connect') {
        const w = worldFromClient(e.clientX, e.clientY);
        const target = [...d().nodes].reverse().find((n) => n.type !== 'group' && n.id !== cur.fromNode && w.x >= n.x && w.x <= n.x + n.width && w.y >= n.y && w.y <= n.y + n.height);
        if (target) {
          const id = uid();
          write({ ...d(), edges: [...d().edges, { id, fromNode: cur.fromNode, fromSide: cur.fromSide, toNode: target.id, toSide: sideForPoint(target, w) }] });
          setSelection({ type: 'edge', id });
        }
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startMove = (e: React.PointerEvent, node: CanvasNode) => {
    e.stopPropagation();
    setSelection({ type: 'node', id: node.id });
    const w = worldFromClient(e.clientX, e.clientY);
    const origins = new Map<string, { x: number; y: number }>([[node.id, { x: node.x, y: node.y }]]);
    if (node.type === 'group') {
      // A group carries every node fully inside it.
      for (const n of d().nodes) {
        if (n.id !== node.id && n.x >= node.x && n.y >= node.y && n.x + n.width <= node.x + node.width && n.y + n.height <= node.y + node.height) {
          origins.set(n.id, { x: n.x, y: n.y });
        }
      }
    }
    beginGesture({ kind: 'move', origins, startWorld: w, moved: false });
  };

  const viewportCenter = () => {
    const rect = containerRef.current!.getBoundingClientRect();
    return worldFromClient(rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  const newCard = (at?: { x: number; y: number }) => {
    const p = at ?? viewportCenter();
    const id = addNode({ type: 'text', text: '', x: Math.round(p.x - 130), y: Math.round(p.y - 70), width: 260, height: 140 });
    setEditing(id);
  };
  const newGroup = () => {
    const p = viewportCenter();
    addNode({ type: 'group', label: 'Group', x: Math.round(p.x - 220), y: Math.round(p.y - 160), width: 440, height: 320 });
  };
  const addNoteCard = (file: string) => {
    const p = viewportCenter();
    addNode({ type: 'file', file, x: Math.round(p.x - 150), y: Math.round(p.y - 110), width: 300, height: 220 });
    setAddNoteOpen(false);
  };
  const addLinkCard = (url: string) => {
    const p = viewportCenter();
    addNode({ type: 'link', url, x: Math.round(p.x - 150), y: Math.round(p.y - 45), width: 300, height: 90 });
    setAddLinkOpen(false);
  };

  // --- Derived ----------------------------------------------------------------
  const nodeById = useMemo(() => new Map(doc.nodes.map((n) => [n.id, n])), [doc]);
  const selectedNode = selection?.type === 'node' ? nodeById.get(selection.id) : undefined;

  if (invalid) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-[var(--ink-muted)]">
        <Frame className="h-5 w-5" />
        This file isn't valid JSON Canvas. Switch to Source mode to fix it.
      </div>
    );
  }

  const gesture = gestureRef.current;
  const connectFrom = gesture?.kind === 'connect' ? nodeById.get(gesture.fromNode) : undefined;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-[var(--canvas)] outline-none"
      style={{ backgroundImage: 'radial-gradient(var(--divider) 1px, transparent 1px)', backgroundSize: `${24 * zoom}px ${24 * zoom}px`, backgroundPosition: `${pan.x}px ${pan.y}px`, cursor: 'grab' }}
      tabIndex={0}
      onWheel={onWheel}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        setSelection(null); setEditing(null); setAddNoteOpen(false); setAddLinkOpen(false);
        containerRef.current?.focus();
        beginGesture({ kind: 'pan', startClient: { x: e.clientX, y: e.clientY }, startPan: panRef.current });
      }}
      onDoubleClick={(e) => { if (e.target === e.currentTarget) newCard(worldFromClient(e.clientX, e.clientY)); }}
      onKeyDown={(e) => {
        const t = e.target as HTMLElement;
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
        if ((e.key === 'Delete' || e.key === 'Backspace') && selection) { e.preventDefault(); deleteSelection(); }
      }}
      role="application"
      aria-label="Canvas"
    >
      <div className="absolute left-0 top-0" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
        {/* Groups (behind everything) */}
        {doc.nodes.filter((n) => n.type === 'group').map((n) => {
          const c = colorOf(n.color) ?? 'var(--ink-muted)';
          const isSel = selection?.type === 'node' && selection.id === n.id;
          return (
            <div
              key={n.id}
              className="absolute rounded-xl"
              style={{ left: n.x, top: n.y, width: n.width, height: n.height, border: `1.5px ${isSel ? 'solid' : 'dashed'} ${isSel ? 'var(--accent)' : c}`, background: `color-mix(in srgb, ${c} 6%, transparent)` }}
              onPointerDown={(e) => startMove(e, n)}
            >
              <input
                className="absolute -top-6 left-1 bg-transparent text-xs font-semibold outline-none"
                style={{ color: c, width: Math.max(80, n.width - 8) }}
                value={n.label ?? ''}
                placeholder="Group"
                onChange={(e) => patchNode(n.id, { label: e.target.value }, false)}
                onBlur={flush}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label="Group label"
              />
              <div className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize" onPointerDown={(e) => { e.stopPropagation(); setSelection({ type: 'node', id: n.id }); beginGesture({ kind: 'resize', id: n.id, origin: { ...n }, startWorld: worldFromClient(e.clientX, e.clientY) }); }} />
            </div>
          );
        })}

        {/* Edges */}
        <svg className="absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden="true">
          <defs>
            <marker id="cnv-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
            </marker>
          </defs>
          {doc.edges.map((e) => {
            const from = nodeById.get(e.fromNode), to = nodeById.get(e.toNode);
            if (!from || !to) return null;
            const [afs, ats] = autoSides(from, to);
            const fs = e.fromSide ?? afs, ts = e.toSide ?? ats;
            const p1 = anchor(from, fs), p2 = anchor(to, ts);
            const stroke = colorOf(e.color) ?? 'var(--ink-muted)';
            const isSel = selection?.type === 'edge' && selection.id === e.id;
            return (
              <g key={e.id}>
                <path d={edgePath(p1, fs, p2, ts)} fill="none" stroke="transparent" strokeWidth={14 / zoom} style={{ cursor: 'pointer' }} onPointerDown={(ev) => { ev.stopPropagation(); setSelection({ type: 'edge', id: e.id }); }} />
                <path d={edgePath(p1, fs, p2, ts)} fill="none" stroke={isSel ? 'var(--accent)' : stroke} strokeWidth={(isSel ? 2.5 : 1.8) / Math.sqrt(zoom)} markerEnd="url(#cnv-arrow)" pointerEvents="none" />
              </g>
            );
          })}
          {connectFrom && connectCursor && (
            <path d={edgePath(anchor(connectFrom, (gesture as { fromSide: Side }).fromSide), (gesture as { fromSide: Side }).fromSide, connectCursor, 'top')} fill="none" stroke="var(--accent)" strokeWidth={2 / zoom} strokeDasharray="6 4" pointerEvents="none" />
          )}
        </svg>

        {/* Edge labels */}
        {doc.edges.map((e) => {
          const from = nodeById.get(e.fromNode), to = nodeById.get(e.toNode);
          if (!from || !to) return null;
          const [afs, ats] = autoSides(from, to);
          const p1 = anchor(from, e.fromSide ?? afs), p2 = anchor(to, e.toSide ?? ats);
          const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
          const isSel = selection?.type === 'edge' && selection.id === e.id;
          if (!e.label && !isSel) return null;
          return (
            <div key={`lbl-${e.id}`} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: mid.x, top: mid.y }} onPointerDown={(ev) => ev.stopPropagation()}>
              {isSel ? (
                <input
                  className="field h-6 w-32 px-2 text-center text-[11px]"
                  value={e.label ?? ''}
                  placeholder="Label…"
                  autoFocus={!e.label}
                  onChange={(ev) => patchEdge(e.id, { label: ev.target.value }, false)}
                  onBlur={flush}
                  aria-label="Edge label"
                />
              ) : (
                <button type="button" className="rounded bg-[var(--canvas)] px-1.5 py-0.5 text-[11px] text-[var(--ink-secondary)]" style={{ border: `1px solid ${colorOf(e.color) ?? 'var(--divider)'}` }} onClick={() => setSelection({ type: 'edge', id: e.id })}>
                  {e.label}
                </button>
              )}
            </div>
          );
        })}

        {/* Cards */}
        {doc.nodes.filter((n) => n.type !== 'group').map((n) => {
          const c = colorOf(n.color);
          const isSel = selection?.type === 'node' && selection.id === n.id;
          const isEditing = editing === n.id;
          return (
            <div
              key={n.id}
              className="group/n absolute flex flex-col overflow-hidden rounded-lg"
              style={{
                left: n.x, top: n.y, width: n.width, height: n.height,
                background: c ? `color-mix(in srgb, ${c} 10%, var(--surface))` : 'var(--surface)',
                border: `1.5px solid ${isSel ? 'var(--accent)' : c ?? 'var(--divider)'}`,
                cursor: isEditing ? 'auto' : 'move',
              }}
              onPointerDown={(e) => { if (!isEditing) startMove(e, n); else e.stopPropagation(); }}
              onDoubleClick={(e) => { e.stopPropagation(); if (n.type === 'text') setEditing(n.id); }}
            >
              {n.type === 'text' && (isEditing ? (
                <textarea
                  className="h-full w-full resize-none bg-transparent p-3 text-sm text-[var(--ink)] outline-none"
                  value={n.text ?? ''}
                  autoFocus
                  placeholder="Write anything…"
                  onChange={(e) => patchNode(n.id, { text: e.target.value }, false)}
                  onBlur={() => { flush(); setEditing(null); }}
                  aria-label="Card text"
                />
              ) : (
                <div className="h-full w-full whitespace-pre-wrap p-3 text-sm text-[var(--ink)]">{n.text || <span className="text-[var(--ink-muted)]">Double-click to edit</span>}</div>
              ))}

              {n.type === 'file' && (
                <>
                  <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--divider)] px-2.5 py-1.5 text-xs font-medium text-[var(--ink-secondary)]">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--accent-strong)]" />
                    <span className="truncate">{n.file?.split('/').pop()}</span>
                    <button type="button" className="vw-icon-btn ml-auto opacity-0 group-hover/n:opacity-100" title="Open note" aria-label={`Open ${n.file}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => n.file && onSelectNote(n.file)}>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                  {n.file && IMAGE_EXT.has(ext(n.file)) ? (
                    imageUrls[n.file] ? <img src={imageUrls[n.file]} alt={n.file} className="min-h-0 flex-1 object-contain p-1" /> : <div className="flex-1" />
                  ) : (
                    <div className="min-h-0 flex-1 overflow-hidden whitespace-pre-wrap p-2.5 text-xs leading-5 text-[var(--ink-secondary)]">
                      {notesData.find((x) => x.path === n.file)?.content.slice(0, 600) ?? <span className="text-[var(--ink-muted)]">Not loaded — click to open.</span>}
                    </div>
                  )}
                </>
              )}

              {n.type === 'link' && (
                <div className="flex h-full items-center gap-2.5 px-3">
                  {(() => { let host = ''; try { host = new URL(safeUrl(n.url) ?? '').hostname; } catch { /* raw */ } return host
                    ? <img src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`} alt="" className="h-7 w-7 shrink-0 rounded" />
                    : <Globe className="h-7 w-7 shrink-0 text-[var(--ink-muted)]" />; })()}
                  <div className="min-w-0">
                    <a href={safeUrl(n.url) ?? undefined} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium text-[var(--ink)] hover:underline" onPointerDown={(e) => e.stopPropagation()}>{n.url}</a>
                    <span className="text-[11px] text-[var(--ink-muted)]">Web link</span>
                  </div>
                </div>
              )}

              {/* Connector dots */}
              {(['top', 'right', 'bottom', 'left'] as Side[]).map((side) => {
                const pos = side === 'top' ? { left: '50%', top: -5 } : side === 'bottom' ? { left: '50%', bottom: -5 } : side === 'left' ? { left: -5, top: '50%' } : { right: -5, top: '50%' };
                return (
                  <div
                    key={side}
                    className="absolute z-10 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-full border border-[var(--accent)] bg-[var(--canvas)] opacity-0 transition-opacity group-hover/n:opacity-100"
                    style={{ ...pos, translate: side === 'right' ? '50% -50%' : side === 'bottom' ? '-50% 50%' : undefined }}
                    onPointerDown={(e) => { e.stopPropagation(); setSelection({ type: 'node', id: n.id }); beginGesture({ kind: 'connect', fromNode: n.id, fromSide: side }); }}
                    title="Drag to connect"
                  />
                );
              })}

              <div className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize" onPointerDown={(e) => { e.stopPropagation(); setSelection({ type: 'node', id: n.id }); beginGesture({ kind: 'resize', id: n.id, origin: { x: n.x, y: n.y, width: n.width, height: n.height }, startWorld: worldFromClient(e.clientX, e.clientY) }); }} />
            </div>
          );
        })}
      </div>

      {doc.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-[var(--ink-muted)]">Double-click anywhere to add your first card.</div>
      )}

      {/* Toolbar */}
      <div className="absolute left-3 top-3 z-20 flex flex-wrap items-center gap-1 rounded-lg bg-[var(--surface)] p-1.5 shadow-sm" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <button type="button" className="vw-icon-btn h-7 w-7" title="New card" aria-label="New card" onClick={() => newCard()}><StickyNote className="h-4 w-4" /></button>
        <button type="button" className="vw-icon-btn h-7 w-7" title="New group" aria-label="New group" onClick={newGroup}><Frame className="h-4 w-4" /></button>
        <button type="button" className="vw-icon-btn h-7 w-7" title="Add note from workspace" aria-label="Add note from workspace" onClick={() => { setAddNoteOpen((v) => !v); setAddLinkOpen(false); }}><FilePlus2 className="h-4 w-4" /></button>
        <button type="button" className="vw-icon-btn h-7 w-7" title="Add web link" aria-label="Add web link" onClick={() => { setAddLinkOpen((v) => !v); setAddNoteOpen(false); }}><Link2 className="h-4 w-4" /></button>
        <button type="button" className="vw-icon-btn h-7 w-7" title="Zoom to fit" aria-label="Zoom to fit" onClick={zoomFit}><Maximize className="h-4 w-4" /></button>
        {selection && (
          <>
            <span className="mx-0.5 h-5 w-px bg-[var(--divider)]" />
            {['1', '2', '3', '4', '5', '6'].map((k) => (
              <button key={k} type="button" className="h-4 w-4 rounded-full border border-[var(--divider)]" style={{ background: PRESET[k] }} title={`Color ${k}`} aria-label={`Set color ${k}`} onClick={() => setColor(k)} />
            ))}
            <button type="button" className="h-4 w-4 rounded-full border border-[var(--divider)] bg-transparent" title="No color" aria-label="Clear color" onClick={() => setColor(undefined)} />
            {selectedNode?.type === 'text' && (
              <button type="button" className="interactive ml-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--accent-strong)] hover:bg-[var(--surface-hover)]" onClick={() => void convertToNote(selectedNode)}>Convert to note</button>
            )}
            <button type="button" className="vw-icon-btn h-7 w-7 hover:text-[var(--danger)]" title="Delete selection" aria-label="Delete selection" onClick={deleteSelection}><Trash2 className="h-4 w-4" /></button>
          </>
        )}
      </div>

      {(addNoteOpen || addLinkOpen) && (
        <div className="absolute left-3 top-14 z-20 rounded-lg bg-[var(--surface)] p-2 shadow-sm" onPointerDown={(e) => e.stopPropagation()}>
          {addNoteOpen ? (
            <>
              <input
                className="field h-8 w-64 px-2.5 text-xs"
                placeholder="Type a note path…"
                list="cnv-notes"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') addNoteCard((e.target as HTMLInputElement).value); }}
                aria-label="Note path"
              />
              <datalist id="cnv-notes">{notesData.map((x) => <option key={x.path} value={x.path} />)}</datalist>
              <p className="mt-1 text-[10px] text-[var(--ink-muted)]">Enter to place the note on the canvas.</p>
            </>
          ) : (
            <>
              <input className="field h-8 w-64 px-2.5 text-xs" placeholder="https://…" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') addLinkCard((e.target as HTMLInputElement).value); }} aria-label="Link URL" />
              <p className="mt-1 text-[10px] text-[var(--ink-muted)]">Enter to add the link card.</p>
            </>
          )}
        </div>
      )}

      <div className="absolute bottom-3 right-3 z-20 rounded bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--ink-muted)]" onPointerDown={(e) => e.stopPropagation()}>
        {Math.round(zoom * 100)}% <button type="button" className="ml-1 font-medium text-[var(--accent-strong)]" onClick={() => { setZoom(1); }}>Reset</button>
      </div>
    </div>
  );
}

registerSurface('canvas', CanvasSurface);

export default CanvasSurface;

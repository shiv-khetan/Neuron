import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, FilePlus2, FileText, FileWarning, Frame, Globe, HelpCircle, Link2, Magnet, Maximize, Minus, Palette, Plus, Redo2, Scan, StickyNote, Trash2, Undo2 } from 'lucide-react';
import { safeUrl } from '@/lib/view-security';
import {
  alignNodes, anchor, applyStylePreset, applyStyleToNodes, autoSides, boundsOf, bringToFront,
  CLEAR_STYLE, colorOf, copyFragment, deleteSelection as deleteFromDoc, distributeNodes,
  edgePath, getNodeStyle, nodesInsideGroup, parseCanvas, pasteFragment, PRESET_COLORS,
  rectsIntersect, sendToBack, serializeCanvas, sideForPoint, STYLE_PRESETS, uid,
  STANDARD_NODE_TYPES,
  type AlignMode, type CanvasDoc, type CanvasEdge, type CanvasNode, type NeuronCanvasStyle, type Rect, type Side,
} from '../canvas/model';
import { CanvasHistory } from '../canvas/history';
import { renderMarkdown } from '../canvas/markdown';
import { registerSurface, type SurfaceProps } from './index';

// ===========================================================================
// .canvas files use the open JSON Canvas format (jsoncanvas.org — the same
// one Obsidian uses). This surface is the rendering/interaction layer only;
// parsing, serialization, geometry, fragments, and undo live in
// src/renderer/canvas/ (see docs/plans/json-canvas-enhancements.md).
// Persistence: every committed gesture serializes back to the file (atomic
// write in main); the watcher folds external edits in live; our own write is
// recognized by text equality and skipped. Unknown fields and unknown node
// types are preserved verbatim — Neuron only edits what it understands.
// ===========================================================================

const SNAP = 16;
const NUDGE_FLUSH_MS = 400;
const TEXT_EXT = /\.(md|mdx|db|canvas|nhtml)$/i;
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);
const fileExt = (p: string) => p.split('.').pop()?.toLowerCase() ?? '';

type Gesture =
  | { kind: 'pan'; startClient: { x: number; y: number }; startPan: { x: number; y: number } }
  | { kind: 'move'; origins: Map<string, { x: number; y: number }>; startWorld: { x: number; y: number }; moved: boolean }
  | { kind: 'resize'; id: string; origin: Rect; startWorld: { x: number; y: number } }
  | { kind: 'connect'; fromNode: string; fromSide: Side }
  | { kind: 'marquee'; startWorld: { x: number; y: number }; base: Set<string> };

interface Menu {
  clientX: number;
  clientY: number;
  worldX: number;
  worldY: number;
  target: { type: 'background' } | { type: 'node'; id: string } | { type: 'edge'; id: string };
}

export function CanvasSurface({ path, content, notesData, onSelectNote }: SurfaceProps) {
  const [doc, setDocState] = useState<CanvasDoc>({ nodes: [], edges: [], extra: {} });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [pan, setPan] = useState({ x: 80, y: 80 });
  const [zoom, setZoom] = useState(1);
  const [selNodes, setSelNodes] = useState<Set<string>>(new Set());
  const [selEdges, setSelEdges] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [connectCursor, setConnectCursor] = useState<{ x: number; y: number } | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<Rect | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [snap, setSnap] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [addNoteOpen, setAddNoteOpen] = useState(false);
  const [addLinkOpen, setAddLinkOpen] = useState(false);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [, forceRender] = useState(0); // history canUndo/canRedo indicators

  const containerRef = useRef<HTMLDivElement>(null);
  const docRef = useRef(doc);
  const panRef = useRef(pan); panRef.current = pan;
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const selNodesRef = useRef(selNodes); selNodesRef.current = selNodes;
  const selEdgesRef = useRef(selEdges); selEdgesRef.current = selEdges;
  const gestureRef = useRef<Gesture | null>(null);
  const lastWritten = useRef<string | null>(null);
  const historyRef = useRef(new CanvasHistory());
  const pendingBefore = useRef<CanvasDoc | null>(null); // pre-change doc of an in-flight staged edit
  const nudgeTimer = useRef<number | null>(null);
  const loadedOnce = useRef(false);

  // --- document pipeline ------------------------------------------------------
  // stage(): update state only (mid-gesture / mid-typing). flush(): commit the
  // staged run as ONE history entry + persist. commit(): one-shot mutation.
  // restore(): apply a history state (persists, records nothing).

  const adopt = useCallback((next: CanvasDoc) => {
    docRef.current = next;
    setDocState(next);
    // Prune selection against the new doc (undo/redo/external edits).
    const nodeIds = new Set(next.nodes.map((n) => n.id));
    const edgeIds = new Set(next.edges.map((e) => e.id));
    setSelNodes((prev) => (([...prev].every((id) => nodeIds.has(id))) ? prev : new Set([...prev].filter((id) => nodeIds.has(id)))));
    setSelEdges((prev) => (([...prev].every((id) => edgeIds.has(id))) ? prev : new Set([...prev].filter((id) => edgeIds.has(id)))));
  }, []);

  const persist = useCallback((next: CanvasDoc) => {
    adopt(next);
    const text = serializeCanvas(next);
    lastWritten.current = text;
    void window.electronAPI.writeNote(path, text);
  }, [adopt, path]);

  const d = () => docRef.current;
  const stage = (next: CanvasDoc) => {
    if (!pendingBefore.current) pendingBefore.current = docRef.current;
    adopt(next);
  };
  const flush = () => {
    if (!pendingBefore.current) return;
    if (pendingBefore.current !== docRef.current) historyRef.current.push(pendingBefore.current);
    pendingBefore.current = null;
    persist(docRef.current);
    forceRender((n) => n + 1);
  };
  const commit = (next: CanvasDoc) => {
    historyRef.current.push(docRef.current);
    pendingBefore.current = null;
    persist(next);
    forceRender((n) => n + 1);
  };
  const undo = () => {
    const prev = historyRef.current.undo(docRef.current);
    if (prev) { pendingBefore.current = null; setEditing(null); persist(prev); forceRender((n) => n + 1); }
  };
  const redo = () => {
    const next = historyRef.current.redo(docRef.current);
    if (next) { pendingBefore.current = null; setEditing(null); persist(next); forceRender((n) => n + 1); }
  };

  const applyParsed = useCallback((text: string, external: boolean) => {
    const { doc: parsed, error, warnings: warns } = parseCanvas(text);
    setLoadError(error);
    setWarnings(warns);
    if (!parsed) return;
    // External/Source edits become an undoable step; undo never resurrects a
    // state the file never had. First load starts history fresh.
    if (external && loadedOnce.current) historyRef.current.push(docRef.current);
    else if (!loadedOnce.current) historyRef.current.reset();
    loadedOnce.current = true;
    pendingBefore.current = null;
    adopt(parsed);
  }, [adopt]);

  // Adopt file content (initial open, Source-mode edits; our own echo excluded).
  useEffect(() => {
    if (content === lastWritten.current) return;
    applyParsed(content, true);
  }, [content, applyParsed]);

  // External edits (Obsidian, git, scripts) land live via the workspace watcher.
  useEffect(() => {
    return window.electronAPI.onNotesChanged((event, changed) => {
      if (changed !== path || event === 'unlink') return;
      void window.electronAPI.readNote(path).then((text) => {
        if (text.startsWith('Error:') || text === lastWritten.current) return;
        applyParsed(text, true);
      });
    });
  }, [path, applyParsed]);

  // Load workspace images referenced by file nodes.
  useEffect(() => {
    for (const n of doc.nodes) {
      if (n.type !== 'file' || !n.file || !IMAGE_EXT.has(fileExt(n.file)) || imageUrls[n.file]) continue;
      void window.electronAPI.views.file(n.file).then((r) => {
        if (r.success && r.dataUrl) setImageUrls((p) => ({ ...p, [n.file as string]: r.dataUrl! }));
      });
    }
  }, [doc]);

  const worldFromClient = (cx: number, cy: number) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: (cx - rect.left - panRef.current.x) / zoomRef.current, y: (cy - rect.top - panRef.current.y) / zoomRef.current };
  };
  const viewportCenter = () => {
    const rect = containerRef.current!.getBoundingClientRect();
    return worldFromClient(rect.left + rect.width / 2, rect.top + rect.height / 2);
  };
  const snapv = (v: number) => (snap ? Math.round(v / SNAP) * SNAP : Math.round(v));

  // --- selection ---------------------------------------------------------------
  const clearSelection = () => { setSelNodes(new Set()); setSelEdges(new Set()); };
  const selectOnlyNode = (id: string) => { setSelNodes(new Set([id])); setSelEdges(new Set()); };
  const selectOnlyEdge = (id: string) => { setSelEdges(new Set([id])); setSelNodes(new Set()); };
  const toggleNode = (id: string) => setSelNodes((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const selectAll = () => { setSelNodes(new Set(d().nodes.map((n) => n.id))); setSelEdges(new Set()); };

  // --- mutations ----------------------------------------------------------------
  const patchNode = (id: string, patch: Partial<CanvasNode>, mode: 'commit' | 'stage' = 'commit') => {
    const next = { ...d(), nodes: d().nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
    (mode === 'commit' ? commit : stage)(next);
  };
  const patchEdge = (id: string, patch: Partial<CanvasEdge>, mode: 'commit' | 'stage' = 'commit') => {
    const next = { ...d(), edges: d().edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) };
    (mode === 'commit' ? commit : stage)(next);
  };
  // Omit<CanvasNode,'id'> degenerates through the index signature, so spell the shape out.
  const addNode = (node: Partial<CanvasNode> & Pick<CanvasNode, 'type' | 'x' | 'y' | 'width' | 'height'>) => {
    const id = uid();
    commit({ ...d(), nodes: [...d().nodes, { ...node, id }] });
    selectOnlyNode(id);
    return id;
  };
  const removeSelection = () => {
    if (selNodesRef.current.size === 0 && selEdgesRef.current.size === 0) return;
    commit(deleteFromDoc(d(), selNodesRef.current, selEdgesRef.current));
    clearSelection();
    setEditing(null);
  };
  const setColor = (color?: string) => {
    const ns = selNodesRef.current, es = selEdgesRef.current;
    if (ns.size === 0 && es.size === 0) return;
    commit({
      ...d(),
      nodes: d().nodes.map((n) => (ns.has(n.id) ? { ...n, color } : n)),
      edges: d().edges.map((e) => (es.has(e.id) ? { ...e, color } : e)),
    });
  };

  // --- clipboard ------------------------------------------------------------------
  const copySelection = async () => {
    if (selNodesRef.current.size === 0) return;
    await navigator.clipboard.writeText(copyFragment(d(), selNodesRef.current));
  };
  const cutSelection = async () => { await copySelection(); removeSelection(); };
  const pasteClipboard = async (at?: { x: number; y: number }) => {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { return; }
    const frag = pasteFragment(text, at);
    if (frag) {
      commit({ ...d(), nodes: [...d().nodes, ...frag.nodes], edges: [...d().edges, ...frag.edges] });
      setSelNodes(frag.ids); setSelEdges(new Set());
    } else if (text.trim() && at) {
      // Plain text from anywhere becomes a card when pasted via the menu.
      const id = addNode({ type: 'text', text: text.slice(0, 10000), x: Math.round(at.x), y: Math.round(at.y), width: 260, height: 140 });
      selectOnlyNode(id);
    }
  };
  const duplicateSelection = () => {
    if (selNodesRef.current.size === 0) return;
    const frag = pasteFragment(copyFragment(d(), selNodesRef.current));
    if (!frag) return;
    commit({ ...d(), nodes: [...d().nodes, ...frag.nodes], edges: [...d().edges, ...frag.edges] });
    setSelNodes(frag.ids); setSelEdges(new Set());
  };

  // --- neuron style extension --------------------------------------------------
  // Groups keep their own dashed look; styling targets cards only. One commit
  // per change, so styling a multi-selection is one undo entry.
  const styleTargets = () =>
    new Set([...selNodesRef.current].filter((id) => d().nodes.find((n) => n.id === id)?.type !== 'group'));
  const applyStyle = (patch: Partial<NeuronCanvasStyle>) => {
    const ids = styleTargets();
    if (ids.size > 0) commit(applyStyleToNodes(d(), ids, patch));
  };
  const applyPreset = (name: string) => {
    const ids = styleTargets();
    if (ids.size > 0) commit(applyStylePreset(d(), ids, name));
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

  // --- viewport --------------------------------------------------------------------
  const fitRect = (box: Rect | null) => {
    const el = containerRef.current;
    if (!el || !box) { setPan({ x: 80, y: 80 }); setZoom(1); return; }
    const rect = el.getBoundingClientRect();
    const z = Math.min(rect.width / (box.width + 120), rect.height / (box.height + 120), 1.5);
    setZoom(z);
    setPan({ x: (rect.width - box.width * z) / 2 - box.x * z, y: (rect.height - box.height * z) / 2 - box.y * z });
  };
  const zoomFit = () => fitRect(boundsOf(d().nodes));
  const zoomFitSelection = () => fitRect(boundsOf(d().nodes.filter((n) => selNodesRef.current.has(n.id))));
  const zoomBy = (factor: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next = Math.min(4, Math.max(0.1, zoomRef.current * factor));
    const cx = rect.width / 2, cy = rect.height / 2;
    const wx = (cx - panRef.current.x) / zoomRef.current, wy = (cy - panRef.current.y) / zoomRef.current;
    setZoom(next);
    setPan({ x: cx - wx * next, y: cy - wy * next });
  };
  const onWheel = (e: React.WheelEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const next = Math.min(4, Math.max(0.1, zoomRef.current * Math.exp(-e.deltaY * 0.0015)));
    const wx = (e.clientX - rect.left - panRef.current.x) / zoomRef.current;
    const wy = (e.clientY - rect.top - panRef.current.y) / zoomRef.current;
    setZoom(next);
    setPan({ x: e.clientX - rect.left - wx * next, y: e.clientY - rect.top - wy * next });
  };

  // --- gestures (window-level listeners live for the duration of a drag) -----------
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
        stage({ ...d(), nodes: d().nodes.map((n) => { const o = cur.origins.get(n.id); return o ? { ...n, x: snapv(o.x + dx), y: snapv(o.y + dy) } : n; }) });
      } else if (cur.kind === 'resize') {
        const dx = w.x - cur.startWorld.x, dy = w.y - cur.startWorld.y;
        patchNode(cur.id, { width: Math.max(80, snapv(cur.origin.width + dx)), height: Math.max(60, snapv(cur.origin.height + dy)) }, 'stage');
      } else if (cur.kind === 'connect') {
        setConnectCursor(w);
      } else if (cur.kind === 'marquee') {
        const rect: Rect = {
          x: Math.min(cur.startWorld.x, w.x), y: Math.min(cur.startWorld.y, w.y),
          width: Math.abs(w.x - cur.startWorld.x), height: Math.abs(w.y - cur.startWorld.y),
        };
        setMarqueeRect(rect);
        const hit = d().nodes.filter((n) => rectsIntersect(rect, n)).map((n) => n.id);
        setSelNodes(new Set([...cur.base, ...hit]));
      }
    };
    const up = (e: PointerEvent) => {
      const cur = gestureRef.current;
      gestureRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setConnectCursor(null);
      setMarqueeRect(null);
      if (!cur) return;
      if (cur.kind === 'move' || cur.kind === 'resize') { flush(); return; }
      if (cur.kind === 'connect') {
        const w = worldFromClient(e.clientX, e.clientY);
        const target = [...d().nodes].reverse().find((n) => n.type !== 'group' && n.id !== cur.fromNode && w.x >= n.x && w.x <= n.x + n.width && w.y >= n.y && w.y <= n.y + n.height);
        if (target) {
          const id = uid();
          commit({ ...d(), edges: [...d().edges, { id, fromNode: cur.fromNode, fromSide: cur.fromSide, toNode: target.id, toSide: sideForPoint(target, w) }] });
          selectOnlyEdge(id);
        }
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startMove = (e: React.PointerEvent, node: CanvasNode) => {
    e.stopPropagation();
    setMenu(null);
    let selected = selNodesRef.current;
    if (e.shiftKey) { toggleNode(node.id); return; }
    if (!selected.has(node.id)) { selectOnlyNode(node.id); selected = new Set([node.id]); }
    const w = worldFromClient(e.clientX, e.clientY);
    const origins = new Map<string, { x: number; y: number }>();
    for (const n of d().nodes) {
      if (!selected.has(n.id)) continue;
      origins.set(n.id, { x: n.x, y: n.y });
      if (n.type === 'group') for (const inside of nodesInsideGroup(d(), n)) origins.set(inside.id, { x: inside.x, y: inside.y });
    }
    beginGesture({ kind: 'move', origins, startWorld: w, moved: false });
  };

  const startResize = (e: React.PointerEvent, n: CanvasNode) => {
    e.stopPropagation();
    selectOnlyNode(n.id);
    beginGesture({ kind: 'resize', id: n.id, origin: { x: n.x, y: n.y, width: n.width, height: n.height }, startWorld: worldFromClient(e.clientX, e.clientY) });
  };

  // --- creation -----------------------------------------------------------------------
  const newCard = (at?: { x: number; y: number }) => {
    const p = at ?? viewportCenter();
    const id = addNode({ type: 'text', text: '', x: Math.round(p.x - 130), y: Math.round(p.y - 70), width: 260, height: 140 });
    setEditing(id);
  };
  const newGroup = (at?: { x: number; y: number }) => {
    const p = at ?? viewportCenter();
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

  // --- keyboard -------------------------------------------------------------------------
  const nudge = (dx: number, dy: number) => {
    const sel = selNodesRef.current;
    if (sel.size === 0) return;
    stage({ ...d(), nodes: d().nodes.map((n) => (sel.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) });
    if (nudgeTimer.current) window.clearTimeout(nudgeTimer.current);
    nudgeTimer.current = window.setTimeout(() => { nudgeTimer.current = null; flush(); }, NUDGE_FLUSH_MS);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') {
      if (e.key === 'Escape') { (t as HTMLInputElement).blur(); }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const step = e.shiftKey ? (snap ? SNAP : 10) : 1;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === 'Delete' || e.key === 'Backspace') { handled(); removeSelection(); }
    else if (e.key === 'Escape') { handled(); setMenu(null); setEditing(null); setAddNoteOpen(false); setAddLinkOpen(false); setStyleOpen(false); clearSelection(); }
    else if (e.key === 'ArrowLeft') { handled(); nudge(-step, 0); }
    else if (e.key === 'ArrowRight') { handled(); nudge(step, 0); }
    else if (e.key === 'ArrowUp') { handled(); nudge(0, -step); }
    else if (e.key === 'ArrowDown') { handled(); nudge(0, step); }
    else if (mod && e.key.toLowerCase() === 'a') { handled(); selectAll(); }
    else if (mod && e.key.toLowerCase() === 'c') { handled(); void copySelection(); }
    else if (mod && e.key.toLowerCase() === 'x') { handled(); void cutSelection(); }
    else if (mod && e.key.toLowerCase() === 'v') { handled(); void pasteClipboard(); }
    else if (mod && e.key.toLowerCase() === 'd') { handled(); duplicateSelection(); }
    else if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { handled(); undo(); }
    else if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { handled(); redo(); }
  };

  // --- derived ----------------------------------------------------------------------------
  const nodeById = useMemo(() => new Map(doc.nodes.map((n) => [n.id, n])), [doc]);
  const notePaths = useMemo(() => new Set(notesData.map((n) => n.path)), [notesData]);
  const soleNode = selNodes.size === 1 && selEdges.size === 0 ? nodeById.get([...selNodes][0]) : undefined;
  const hasSelection = selNodes.size > 0 || selEdges.size > 0;

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-[var(--ink-muted)]">
        <Frame className="h-5 w-5" />
        <p className="max-w-md">This file isn't a readable JSON Canvas: {loadError}</p>
        <p>Switch to Source mode to fix it — Neuron never rewrites a file it can't parse.</p>
      </div>
    );
  }

  const gesture = gestureRef.current;
  const connectFrom = gesture?.kind === 'connect' ? nodeById.get(gesture.fromNode) : undefined;

  // --- context menu items --------------------------------------------------------------------
  const menuItem = (label: string, action: () => void, danger = false) => (
    <button
      key={label}
      type="button"
      className={`interactive block w-full rounded px-2 py-1 text-left text-xs ${danger ? 'text-[var(--danger)]' : 'text-[var(--ink)]'} hover:bg-[var(--surface-hover)]`}
      onClick={() => { setMenu(null); action(); }}
    >
      {label}
    </button>
  );
  const menuSep = (k: string) => <div key={k} className="my-1 h-px bg-[var(--divider)]" />;

  const buildMenu = (m: Menu): React.ReactNode[] => {
    const at = { x: m.worldX, y: m.worldY };
    if (m.target.type === 'background') {
      return [
        menuItem('New card', () => newCard(at)),
        menuItem('New group', () => newGroup(at)),
        menuItem('Paste here', () => void pasteClipboard(at)),
        menuSep('s1'),
        menuItem(snap ? 'Disable grid snap' : 'Enable grid snap', () => setSnap((v) => !v)),
        menuItem('Zoom to fit', zoomFit),
        menuItem('Select all', selectAll),
      ];
    }
    if (m.target.type === 'edge') {
      const id = m.target.id;
      const edge = doc.edges.find((e) => e.id === id);
      if (!edge) return [];
      return [
        menuItem('Reverse direction', () => patchEdge(id, {
          fromNode: edge.toNode, toNode: edge.fromNode,
          fromSide: edge.toSide, toSide: edge.fromSide,
          fromEnd: edge.toEnd === 'none' ? 'none' : undefined, toEnd: edge.fromEnd === 'arrow' ? undefined : edge.fromEnd === 'none' ? 'none' : undefined,
        })),
        menuItem('Arrow at end (default)', () => patchEdge(id, { fromEnd: undefined, toEnd: undefined })),
        menuItem('Arrows on both ends', () => patchEdge(id, { fromEnd: 'arrow', toEnd: undefined })),
        menuItem('No arrows', () => patchEdge(id, { fromEnd: undefined, toEnd: 'none' })),
        menuSep('s1'),
        menuItem('Delete edge', removeSelection, true),
      ];
    }
    const node = nodeById.get(m.target.id);
    const many = selNodes.size > 1;
    const items: React.ReactNode[] = [
      menuItem('Cut', () => void cutSelection()),
      menuItem('Copy', () => void copySelection()),
      menuItem('Duplicate', duplicateSelection),
      menuSep('s1'),
      menuItem('Style…', () => setStyleOpen(true)),
      menuItem('Bring to front', () => commit(bringToFront(d(), selNodesRef.current))),
      menuItem('Send to back', () => commit(sendToBack(d(), selNodesRef.current))),
    ];
    if (many) {
      items.push(menuSep('s2'));
      const align = (label: string, mode: AlignMode) => menuItem(`Align ${label}`, () => commit(alignNodes(d(), selNodesRef.current, mode)));
      items.push(align('left', 'left'), align('center', 'centerX'), align('right', 'right'), align('top', 'top'), align('middle', 'centerY'), align('bottom', 'bottom'));
      if (selNodes.size >= 3) {
        items.push(
          menuItem('Distribute horizontally', () => commit(distributeNodes(d(), selNodesRef.current, 'x'))),
          menuItem('Distribute vertically', () => commit(distributeNodes(d(), selNodesRef.current, 'y'))),
        );
      }
    }
    if (!many && node?.type === 'text') { items.push(menuSep('s3'), menuItem('Convert to note', () => void convertToNote(node))); }
    if (!many && node?.type === 'file' && node.file) { items.push(menuSep('s3'), menuItem('Open note', () => onSelectNote(node.file!))); }
    items.push(menuSep('s4'), menuItem(many ? `Delete ${selNodes.size} nodes` : 'Delete', removeSelection, true));
    return items;
  };

  const openMenu = (e: React.MouseEvent, target: Menu['target']) => {
    e.preventDefault();
    e.stopPropagation();
    if (target.type === 'node' && !selNodesRef.current.has(target.id)) selectOnlyNode(target.id);
    if (target.type === 'edge' && !selEdgesRef.current.has(target.id)) selectOnlyEdge(target.id);
    const w = worldFromClient(e.clientX, e.clientY);
    const rect = containerRef.current!.getBoundingClientRect();
    setMenu({ clientX: e.clientX - rect.left, clientY: e.clientY - rect.top, worldX: w.x, worldY: w.y, target });
  };

  // --- render -------------------------------------------------------------------------------
  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-[var(--canvas)] outline-none"
      style={{ backgroundImage: 'radial-gradient(var(--divider) 1px, transparent 1px)', backgroundSize: `${24 * zoom}px ${24 * zoom}px`, backgroundPosition: `${pan.x}px ${pan.y}px`, cursor: 'grab' }}
      tabIndex={0}
      onWheel={onWheel}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        setMenu(null); setEditing(null); setAddNoteOpen(false); setAddLinkOpen(false); setStyleOpen(false);
        containerRef.current?.focus();
        if (e.shiftKey) {
          beginGesture({ kind: 'marquee', startWorld: worldFromClient(e.clientX, e.clientY), base: new Set(selNodesRef.current) });
        } else {
          clearSelection();
          beginGesture({ kind: 'pan', startClient: { x: e.clientX, y: e.clientY }, startPan: panRef.current });
        }
      }}
      onDoubleClick={(e) => { if (e.target === e.currentTarget) newCard(worldFromClient(e.clientX, e.clientY)); }}
      onContextMenu={(e) => { if (e.target === e.currentTarget) openMenu(e, { type: 'background' }); }}
      onKeyDown={onKeyDown}
      role="application"
      aria-label="Canvas"
    >
      <div className="absolute left-0 top-0" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
        {/* Groups (behind everything) */}
        {doc.nodes.filter((n) => n.type === 'group').map((n) => {
          const c = colorOf(n.color) ?? 'var(--ink-muted)';
          const isSel = selNodes.has(n.id);
          return (
            <div
              key={n.id}
              className="absolute rounded-xl"
              style={{ left: n.x, top: n.y, width: n.width, height: n.height, border: `1.5px ${isSel ? 'solid' : 'dashed'} ${isSel ? 'var(--accent)' : c}`, background: `color-mix(in srgb, ${c} 6%, transparent)` }}
              onPointerDown={(e) => startMove(e, n)}
              onContextMenu={(e) => openMenu(e, { type: 'node', id: n.id })}
            >
              <input
                className="absolute -top-6 left-1 bg-transparent text-xs font-semibold outline-none"
                style={{ color: c, width: Math.max(80, n.width - 8) }}
                value={n.label ?? ''}
                placeholder="Group"
                onChange={(e) => patchNode(n.id, { label: e.target.value }, 'stage')}
                onBlur={flush}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label="Group label"
              />
              <div className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize" onPointerDown={(e) => startResize(e, n)} />
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
            const isSel = selEdges.has(e.id);
            return (
              <g key={e.id}>
                <path
                  d={edgePath(p1, fs, p2, ts)} fill="none" stroke="transparent" strokeWidth={14 / zoom} style={{ cursor: 'pointer' }}
                  onPointerDown={(ev) => { ev.stopPropagation(); if (ev.shiftKey) setSelEdges((prev) => { const s = new Set(prev); if (s.has(e.id)) s.delete(e.id); else s.add(e.id); return s; }); else selectOnlyEdge(e.id); }}
                  onContextMenu={(ev) => openMenu(ev as unknown as React.MouseEvent, { type: 'edge', id: e.id })}
                />
                <path
                  d={edgePath(p1, fs, p2, ts)} fill="none" stroke={isSel ? 'var(--accent)' : stroke} strokeWidth={(isSel ? 2.5 : 1.8) / Math.sqrt(zoom)}
                  markerStart={e.fromEnd === 'arrow' ? 'url(#cnv-arrow)' : undefined}
                  markerEnd={e.toEnd === 'none' ? undefined : 'url(#cnv-arrow)'}
                  pointerEvents="none"
                />
              </g>
            );
          })}
          {connectFrom && connectCursor && gesture?.kind === 'connect' && (
            <path d={edgePath(anchor(connectFrom, gesture.fromSide), gesture.fromSide, connectCursor, 'top')} fill="none" stroke="var(--accent)" strokeWidth={2 / zoom} strokeDasharray="6 4" pointerEvents="none" />
          )}
          {marqueeRect && (
            <rect x={marqueeRect.x} y={marqueeRect.y} width={marqueeRect.width} height={marqueeRect.height} fill="color-mix(in srgb, var(--accent) 10%, transparent)" stroke="var(--accent)" strokeWidth={1 / zoom} strokeDasharray="4 3" pointerEvents="none" />
          )}
        </svg>

        {/* Edge labels */}
        {doc.edges.map((e) => {
          const from = nodeById.get(e.fromNode), to = nodeById.get(e.toNode);
          if (!from || !to) return null;
          const [afs, ats] = autoSides(from, to);
          const p1 = anchor(from, e.fromSide ?? afs), p2 = anchor(to, e.toSide ?? ats);
          const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
          const isSel = selEdges.has(e.id);
          if (!e.label && !isSel) return null;
          return (
            <div key={`lbl-${e.id}`} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: mid.x, top: mid.y }} onPointerDown={(ev) => ev.stopPropagation()}>
              {isSel && selEdges.size === 1 ? (
                <input
                  className="field h-6 w-32 px-2 text-center text-[11px]"
                  value={e.label ?? ''}
                  placeholder="Label…"
                  autoFocus={!e.label}
                  onChange={(ev) => patchEdge(e.id, { label: ev.target.value }, 'stage')}
                  onBlur={flush}
                  aria-label="Edge label"
                />
              ) : (
                <button type="button" className="rounded bg-[var(--canvas)] px-1.5 py-0.5 text-[11px] text-[var(--ink-secondary)]" style={{ border: `1px solid ${colorOf(e.color) ?? 'var(--divider)'}` }} onClick={() => selectOnlyEdge(e.id)}>
                  {e.label}
                </button>
              )}
            </div>
          );
        })}

        {/* Cards */}
        {doc.nodes.filter((n) => n.type !== 'group').map((n) => {
          const c = colorOf(n.color);
          const isSel = selNodes.has(n.id);
          const isEditing = editing === n.id;
          const standard = (STANDARD_NODE_TYPES as readonly string[]).includes(n.type);
          const brokenFile = n.type === 'file' && !!n.file && TEXT_EXT.test(n.file) && !notePaths.has(n.file);
          // Validated neuron.style (v1); malformed/future extensions fall back to {}.
          const st = getNodeStyle(n);
          const bw = st.borderWidth ?? 1.5;
          return (
            <div
              key={n.id}
              className="group/n absolute flex flex-col overflow-hidden rounded-lg"
              style={{
                left: n.x, top: n.y, width: n.width, height: n.height,
                background: c ? `color-mix(in srgb, ${c} 10%, var(--surface))` : 'var(--surface)',
                border: `${isSel ? Math.max(bw, 1.5) : bw}px ${st.borderStyle ?? 'solid'} ${isSel ? 'var(--accent)' : c ?? 'var(--divider)'}`,
                borderRadius: st.shape === 'rectangle' ? 2 : st.shape === 'rounded' ? 12 : st.shape === 'pill' ? 999 : st.shape === 'ellipse' ? '50%' : undefined,
                opacity: st.opacity,
                boxShadow: isSel && selNodes.size > 1 ? '0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent)' : undefined,
                cursor: isEditing ? 'auto' : 'move',
              }}
              onPointerDown={(e) => { if (!isEditing) startMove(e, n); else e.stopPropagation(); }}
              onDoubleClick={(e) => { e.stopPropagation(); if (n.type === 'text') setEditing(n.id); }}
              onContextMenu={(e) => openMenu(e, { type: 'node', id: n.id })}
            >
              {n.type === 'text' && (isEditing ? (
                <textarea
                  className="h-full w-full resize-none bg-transparent p-3 text-sm text-[var(--ink)] outline-none"
                  style={{ textAlign: st.textAlign, fontSize: st.fontSize }}
                  value={n.text ?? ''}
                  autoFocus
                  placeholder="Write anything… (Markdown supported)"
                  onChange={(e) => patchNode(n.id, { text: e.target.value }, 'stage')}
                  onBlur={() => { flush(); setEditing(null); }}
                  aria-label="Card text"
                />
              ) : (
                <div className="h-full w-full overflow-hidden p-3 text-sm text-[var(--ink)]" style={{ textAlign: st.textAlign, fontSize: st.fontSize }}>
                  {n.text ? renderMarkdown(n.text) : <span className="text-[var(--ink-muted)]">Double-click to edit</span>}
                </div>
              ))}

              {n.type === 'file' && (
                <>
                  <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--divider)] px-2.5 py-1.5 text-xs font-medium text-[var(--ink-secondary)]">
                    {brokenFile
                      ? <FileWarning className="h-3.5 w-3.5 shrink-0 text-[var(--danger)]" />
                      : <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--accent-strong)]" />}
                    <span className="truncate">{n.file?.split('/').pop()}</span>
                    {brokenFile && <span className="rounded bg-[color-mix(in_srgb,var(--danger)_15%,transparent)] px-1 text-[10px] text-[var(--danger)]">missing</span>}
                    <button type="button" className="vw-icon-btn ml-auto opacity-0 group-hover/n:opacity-100" title="Open note" aria-label={`Open ${n.file}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => n.file && onSelectNote(n.file)}>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                  {n.file && IMAGE_EXT.has(fileExt(n.file)) ? (
                    imageUrls[n.file] ? <img src={imageUrls[n.file]} alt={n.file} className="min-h-0 flex-1 object-contain p-1" /> : <div className="flex-1" />
                  ) : (
                    <div className="min-h-0 flex-1 overflow-hidden whitespace-pre-wrap p-2.5 text-xs leading-5 text-[var(--ink-secondary)]">
                      {notesData.find((x) => x.path === n.file)?.content.slice(0, 600)
                        ?? <span className="text-[var(--ink-muted)]">{brokenFile ? 'File not found in this workspace. Fix the path in Source mode or delete the card.' : 'Not loaded — click to open.'}</span>}
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

              {/* Unknown node types from other tools: preserved, movable, never edited. */}
              {!standard && (
                <div className="flex h-full flex-col items-center justify-center gap-1 p-3 text-center">
                  <HelpCircle className="h-4 w-4 text-[var(--ink-muted)]" />
                  <span className="text-xs font-medium text-[var(--ink-secondary)]">Unsupported node type “{n.type}”</span>
                  <span className="text-[10px] text-[var(--ink-muted)]">Preserved as-is; edits in other tools are safe.</span>
                </div>
              )}

              {/* Connector dots */}
              {standard && (['top', 'right', 'bottom', 'left'] as Side[]).map((side) => {
                const pos = side === 'top' ? { left: '50%', top: -5 } : side === 'bottom' ? { left: '50%', bottom: -5 } : side === 'left' ? { left: -5, top: '50%' } : { right: -5, top: '50%' };
                return (
                  <div
                    key={side}
                    className="absolute z-10 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-full border border-[var(--accent)] bg-[var(--canvas)] opacity-0 transition-opacity group-hover/n:opacity-100"
                    style={{ ...pos, translate: side === 'right' ? '50% -50%' : side === 'bottom' ? '-50% 50%' : undefined }}
                    onPointerDown={(e) => { e.stopPropagation(); selectOnlyNode(n.id); beginGesture({ kind: 'connect', fromNode: n.id, fromSide: side }); }}
                    title="Drag to connect"
                  />
                );
              })}

              <div className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize" onPointerDown={(e) => startResize(e, n)} />
            </div>
          );
        })}
      </div>

      {doc.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-[var(--ink-muted)]">Double-click anywhere to add your first card. Right-click for more.</div>
      )}

      {/* Context menu */}
      {menu && (
        <div
          className="absolute z-30 w-52 rounded-lg border border-[var(--divider)] bg-[var(--surface)] p-1 shadow-lg"
          style={{ left: Math.min(menu.clientX, (containerRef.current?.clientWidth ?? 400) - 216), top: Math.min(menu.clientY, (containerRef.current?.clientHeight ?? 300) - 320) }}
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          role="menu"
        >
          {buildMenu(menu)}
        </div>
      )}

      {/* Toolbar */}
      <div className="absolute left-3 top-3 z-20 flex flex-wrap items-center gap-1 rounded-lg bg-[var(--surface)] p-1.5 shadow-sm" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <button type="button" className="vw-icon-btn h-7 w-7" title="New card (double-click canvas)" aria-label="New card" onClick={() => newCard()}><StickyNote className="h-4 w-4" /></button>
        <button type="button" className="vw-icon-btn h-7 w-7" title="New group" aria-label="New group" onClick={() => newGroup()}><Frame className="h-4 w-4" /></button>
        <button type="button" className="vw-icon-btn h-7 w-7" title="Add note from workspace" aria-label="Add note from workspace" onClick={() => { setAddNoteOpen((v) => !v); setAddLinkOpen(false); }}><FilePlus2 className="h-4 w-4" /></button>
        <button type="button" className="vw-icon-btn h-7 w-7" title="Add web link" aria-label="Add web link" onClick={() => { setAddLinkOpen((v) => !v); setAddNoteOpen(false); }}><Link2 className="h-4 w-4" /></button>
        <span className="mx-0.5 h-5 w-px bg-[var(--divider)]" />
        <button type="button" className="vw-icon-btn h-7 w-7 disabled:opacity-35" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!historyRef.current.canUndo} onClick={undo}><Undo2 className="h-4 w-4" /></button>
        <button type="button" className="vw-icon-btn h-7 w-7 disabled:opacity-35" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!historyRef.current.canRedo} onClick={redo}><Redo2 className="h-4 w-4" /></button>
        <button type="button" className={`vw-icon-btn h-7 w-7 ${snap ? 'text-[var(--accent-strong)]' : ''}`} title="Snap to grid" aria-label="Snap to grid" aria-pressed={snap} onClick={() => setSnap((v) => !v)}><Magnet className="h-4 w-4" /></button>
        {hasSelection && (
          <>
            <span className="mx-0.5 h-5 w-px bg-[var(--divider)]" />
            {Object.keys(PRESET_COLORS).map((k) => (
              <button key={k} type="button" className="h-4 w-4 rounded-full border border-[var(--divider)]" style={{ background: PRESET_COLORS[k] }} title={`Color ${k}`} aria-label={`Set color ${k}`} onClick={() => setColor(k)} />
            ))}
            <button type="button" className="h-4 w-4 rounded-full border border-[var(--divider)] bg-transparent" title="No color" aria-label="Clear color" onClick={() => setColor(undefined)} />
            {selNodes.size > 0 && (
              <button type="button" className={`vw-icon-btn h-7 w-7 ${styleOpen ? 'text-[var(--accent-strong)]' : ''}`} title="Node style" aria-label="Node style" aria-expanded={styleOpen} onClick={() => { setStyleOpen((v) => !v); setAddNoteOpen(false); setAddLinkOpen(false); }}><Palette className="h-4 w-4" /></button>
            )}
            {soleNode?.type === 'text' && (
              <button type="button" className="interactive ml-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--accent-strong)] hover:bg-[var(--surface-hover)]" onClick={() => void convertToNote(soleNode)}>Convert to note</button>
            )}
            <button type="button" className="vw-icon-btn h-7 w-7 hover:text-[var(--danger)]" title="Delete selection" aria-label="Delete selection" onClick={removeSelection}><Trash2 className="h-4 w-4" /></button>
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
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') addNoteCard((e.target as HTMLInputElement).value); }}
                aria-label="Note path"
              />
              <datalist id="cnv-notes">{notesData.map((x) => <option key={x.path} value={x.path} />)}</datalist>
              <p className="mt-1 text-[10px] text-[var(--ink-muted)]">Enter to place the note on the canvas.</p>
            </>
          ) : (
            <>
              <input className="field h-8 w-64 px-2.5 text-xs" placeholder="https://…" autoFocus onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') addLinkCard((e.target as HTMLInputElement).value); }} aria-label="Link URL" />
              <p className="mt-1 text-[10px] text-[var(--ink-muted)]">Enter to add the link card.</p>
            </>
          )}
        </div>
      )}

      {/* Style panel: neuron.style v1 (namespaced extension; standard color stays in the toolbar) */}
      {styleOpen && selNodes.size > 0 && (() => {
        const first = doc.nodes.find((n) => selNodes.has(n.id) && n.type !== 'group');
        if (!first) return null;
        const st = getNodeStyle(first);
        const chip = (label: string, active: boolean, patch: Partial<NeuronCanvasStyle>) => (
          <button
            key={label}
            type="button"
            aria-pressed={active}
            className={`interactive rounded px-1.5 py-0.5 text-[11px] ${active ? 'bg-[var(--surface-hover)] font-semibold text-[var(--accent-strong)]' : 'text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)]'}`}
            onClick={() => applyStyle(active ? Object.fromEntries(Object.keys(patch).map((k) => [k, undefined])) : patch)}
          >
            {label}
          </button>
        );
        const row = (label: string, children: React.ReactNode) => (
          <div className="flex items-center gap-1">
            <span className="w-14 shrink-0 text-[10px] font-medium uppercase tracking-wide text-[var(--ink-muted)]">{label}</span>
            {children}
          </div>
        );
        return (
          <div className="absolute left-3 top-14 z-20 flex w-72 flex-col gap-1.5 rounded-lg border border-[var(--divider)] bg-[var(--surface)] p-2.5 shadow-lg" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            {row('Preset', <>
              {Object.keys(STYLE_PRESETS).map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={st.preset === p}
                  className={`interactive rounded px-1.5 py-0.5 text-[11px] ${st.preset === p ? 'bg-[var(--surface-hover)] font-semibold text-[var(--accent-strong)]' : 'text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)]'}`}
                  onClick={() => (st.preset === p ? applyStyle(CLEAR_STYLE) : applyPreset(p))}
                >
                  {p}
                </button>
              ))}
            </>)}
            {row('Shape', <>
              {chip('rect', st.shape === 'rectangle', { shape: 'rectangle' })}
              {chip('rounded', st.shape === 'rounded', { shape: 'rounded' })}
              {chip('pill', st.shape === 'pill', { shape: 'pill' })}
              {chip('ellipse', st.shape === 'ellipse', { shape: 'ellipse' })}
            </>)}
            {row('Border', <>
              {chip('solid', st.borderStyle === 'solid', { borderStyle: 'solid' })}
              {chip('dashed', st.borderStyle === 'dashed', { borderStyle: 'dashed' })}
              {chip('dotted', st.borderStyle === 'dotted', { borderStyle: 'dotted' })}
              {chip('thick', st.borderWidth === 3, { borderWidth: 3 })}
            </>)}
            {row('Align', <>
              {chip('left', st.textAlign === 'left', { textAlign: 'left' })}
              {chip('center', st.textAlign === 'center', { textAlign: 'center' })}
              {chip('right', st.textAlign === 'right', { textAlign: 'right' })}
            </>)}
            {row('Text', <>
              {chip('A', st.fontSize === 12, { fontSize: 12 })}
              {chip('A+', st.fontSize === 18, { fontSize: 18 })}
              {chip('A++', st.fontSize === 24, { fontSize: 24 })}
            </>)}
            {row('Opacity', <>
              {chip('75%', st.opacity === 0.75, { opacity: 0.75 })}
              {chip('50%', st.opacity === 0.5, { opacity: 0.5 })}
            </>)}
            <div className="mt-0.5 flex items-center justify-between border-t border-[var(--divider)] pt-1.5">
              <button type="button" className="interactive rounded px-1.5 py-0.5 text-[11px] text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)]" onClick={() => applyStyle(CLEAR_STYLE)}>Reset style</button>
              <span className="text-[10px] text-[var(--ink-muted)]">{selNodes.size > 1 ? `${selNodes.size} nodes · one undo step` : 'Stored as neuron.style'}</span>
            </div>
          </div>
        );
      })()}

      {/* Parse warnings (recoverable) */}
      {warnings.length > 0 && (
        <div className="absolute bottom-3 left-3 z-20" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--ink-secondary)] shadow-sm"
            onClick={() => setWarningsOpen((v) => !v)}
            aria-expanded={warningsOpen}
          >
            <AlertTriangle className="h-3.5 w-3.5 text-[var(--danger)]" /> {warnings.length} warning{warnings.length > 1 ? 's' : ''}
          </button>
          {warningsOpen && (
            <ul className="mt-1 max-h-48 w-80 overflow-auto rounded-lg border border-[var(--divider)] bg-[var(--surface)] p-2 text-[11px] text-[var(--ink-secondary)] shadow-lg">
              {warnings.map((w, i) => <li key={i} className="py-0.5">{w}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Zoom controls */}
      <div className="absolute bottom-3 right-3 z-20 flex items-center gap-0.5 rounded bg-[var(--surface)] px-1 py-0.5 text-[11px] text-[var(--ink-muted)] shadow-sm" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" className="vw-icon-btn h-6 w-6" title="Zoom out" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}><Minus className="h-3.5 w-3.5" /></button>
        <button type="button" className="min-w-10 px-1 font-medium text-[var(--ink-secondary)]" title="Reset zoom" aria-label="Reset zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
        <button type="button" className="vw-icon-btn h-6 w-6" title="Zoom in" aria-label="Zoom in" onClick={() => zoomBy(1.25)}><Plus className="h-3.5 w-3.5" /></button>
        <button type="button" className="vw-icon-btn h-6 w-6" title="Zoom to fit" aria-label="Zoom to fit" onClick={zoomFit}><Maximize className="h-3.5 w-3.5" /></button>
        {selNodes.size > 0 && (
          <button type="button" className="vw-icon-btn h-6 w-6" title="Fit selection" aria-label="Fit selection" onClick={zoomFitSelection}><Scan className="h-3.5 w-3.5" /></button>
        )}
      </div>
    </div>
  );
}

registerSurface('canvas', CanvasSurface);

export default CanvasSurface;

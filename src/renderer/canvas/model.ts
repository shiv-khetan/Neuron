// JSON Canvas document model: types, defensive parsing with diagnostics,
// spec-faithful serialization, unknown-field preservation, geometry helpers,
// clipboard fragments, z-order, and alignment. Pure data — no DOM, no IPC —
// so tools/canvas-model.test.mjs can exercise it in plain Node.
//
// Compatibility contract (see docs/plans/json-canvas-enhancements.md):
// unknown top-level keys, unknown node/edge properties, and unknown node
// *types* all survive load→edit→save. Standard fields are never renamed or
// defaulted into existence. The `neuron` key is reserved for namespaced,
// versioned Neuron extensions.

export type Side = 'top' | 'right' | 'bottom' | 'left';
export type EdgeEnd = 'none' | 'arrow';

export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];
export const STANDARD_NODE_TYPES = ['text', 'file', 'link', 'group'] as const;

/** A node. `type` is open (unknown types are preserved); unknown props ride along. */
export interface CanvasNode {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string; // text nodes (Markdown per spec)
  file?: string; // file nodes (workspace-relative path)
  url?: string; // link nodes
  label?: string; // groups
  [key: string]: unknown;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: Side;
  toSide?: Side;
  fromEnd?: EdgeEnd; // spec default: "none"
  toEnd?: EdgeEnd; // spec default: "arrow"
  color?: string;
  label?: string;
  [key: string]: unknown;
}

export interface CanvasDoc {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  /** Unknown top-level keys, restored verbatim on serialize. */
  extra: Record<string, unknown>;
}

export interface ParseResult {
  doc: CanvasDoc | null;
  /** Fatal problem — the file cannot be loaded safely. */
  error: string | null;
  /** Recoverable problems — loaded, but the user should know. */
  warnings: string[];
}

/** Byte ceiling shared with the other surfaces (see lib/view-security.ts). */
export const MAX_CANVAS_BYTES = 2 * 1024 * 1024;

export const EMPTY_DOC: CanvasDoc = { nodes: [], edges: [], extra: {} };

export const uid = (): string => Math.random().toString(36).slice(2, 10);

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// --- parse -------------------------------------------------------------------

export function parseCanvas(text: string): ParseResult {
  if (!text.trim()) return { doc: { nodes: [], edges: [], extra: {} }, error: null, warnings: [] };
  if (text.length > MAX_CANVAS_BYTES) {
    return { doc: null, error: 'Canvas exceeds the 2 MB size limit.', warnings: [] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { doc: null, error: `Not valid JSON: ${e instanceof Error ? e.message : String(e)}`, warnings: [] };
  }
  if (!isObject(raw)) return { doc: null, error: 'A canvas must be a JSON object with "nodes" and "edges".', warnings: [] };

  const warnings: string[] = [];
  const { nodes: rawNodes, edges: rawEdges, ...extra } = raw;
  if (rawNodes !== undefined && !Array.isArray(rawNodes)) warnings.push('"nodes" is not an array — treated as empty.');
  if (rawEdges !== undefined && !Array.isArray(rawEdges)) warnings.push('"edges" is not an array — treated as empty.');

  const nodes: CanvasNode[] = [];
  const seenIds = new Set<string>();
  for (const [i, entry] of (Array.isArray(rawNodes) ? rawNodes : []).entries()) {
    if (!isObject(entry)) { warnings.push(`Node #${i + 1} is not an object — dropped.`); continue; }
    const node = { ...entry } as CanvasNode;
    if (typeof node.id !== 'string' || !node.id) { node.id = uid(); warnings.push(`Node #${i + 1} was missing an id — assigned "${node.id}".`); }
    if (seenIds.has(node.id)) {
      const fresh = uid();
      warnings.push(`Duplicate node id "${node.id}" — renamed to "${fresh}" (edges keep pointing to the first).`);
      node.id = fresh;
    }
    seenIds.add(node.id);
    if (typeof node.type !== 'string' || !node.type) { node.type = 'text'; warnings.push(`Node "${node.id}" had no type — treated as text.`); }
    // Geometry is required by the spec; recover with defaults rather than dropping content.
    if (!finite(node.x)) { node.x = 0; warnings.push(`Node "${node.id}" had invalid x — set to 0.`); }
    if (!finite(node.y)) { node.y = 0; warnings.push(`Node "${node.id}" had invalid y — set to 0.`); }
    if (!finite(node.width) || node.width <= 0) { node.width = 260; warnings.push(`Node "${node.id}" had invalid width — set to 260.`); }
    if (!finite(node.height) || node.height <= 0) { node.height = 140; warnings.push(`Node "${node.id}" had invalid height — set to 140.`); }
    nodes.push(node);
  }

  const edges: CanvasEdge[] = [];
  const seenEdgeIds = new Set<string>();
  for (const [i, entry] of (Array.isArray(rawEdges) ? rawEdges : []).entries()) {
    if (!isObject(entry)) { warnings.push(`Edge #${i + 1} is not an object — dropped.`); continue; }
    const edge = { ...entry } as CanvasEdge;
    if (typeof edge.id !== 'string' || !edge.id) { edge.id = uid(); warnings.push(`Edge #${i + 1} was missing an id — assigned "${edge.id}".`); }
    if (seenEdgeIds.has(edge.id)) { edge.id = uid(); warnings.push(`Duplicate edge id — renamed to "${edge.id}".`); }
    seenEdgeIds.add(edge.id);
    if (typeof edge.fromNode !== 'string' || typeof edge.toNode !== 'string') {
      warnings.push(`Edge "${edge.id}" is missing endpoints — dropped.`);
      continue;
    }
    if (!seenIds.has(edge.fromNode) || !seenIds.has(edge.toNode)) {
      // Preserved (it may reference nodes another tool understands) but flagged;
      // the renderer skips edges whose endpoints are absent.
      warnings.push(`Edge "${edge.id}" references a missing node.`);
    }
    edges.push(edge);
  }

  return { doc: { nodes, edges, extra }, error: null, warnings };
}

// --- serialize -----------------------------------------------------------------

/**
 * Tab-indented + trailing newline (Obsidian's convention). Unknown top-level
 * keys come back; `nodes`/`edges` are written last for stable diffs.
 */
export function serializeCanvas(doc: CanvasDoc): string {
  return JSON.stringify({ ...doc.extra, nodes: doc.nodes, edges: doc.edges }, null, '\t') + '\n';
}

// --- geometry -------------------------------------------------------------------

export const anchor = (n: CanvasNode, side: Side): { x: number; y: number } =>
  side === 'top' ? { x: n.x + n.width / 2, y: n.y }
  : side === 'bottom' ? { x: n.x + n.width / 2, y: n.y + n.height }
  : side === 'left' ? { x: n.x, y: n.y + n.height / 2 }
  : { x: n.x + n.width, y: n.y + n.height / 2 };

export const SIDE_NORMAL: Record<Side, { x: number; y: number }> = {
  top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
};

/** Pick facing sides for an edge whose sides weren't stored. */
export function autoSides(a: CanvasNode, b: CanvasNode): [Side, Side] {
  const dx = (b.x + b.width / 2) - (a.x + a.width / 2);
  const dy = (b.y + b.height / 2) - (a.y + a.height / 2);
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? ['right', 'left'] : ['left', 'right']) : (dy > 0 ? ['bottom', 'top'] : ['top', 'bottom']);
}

export function sideForPoint(n: CanvasNode, p: { x: number; y: number }): Side {
  const dx = (p.x - (n.x + n.width / 2)) / n.width;
  const dy = (p.y - (n.y + n.height / 2)) / n.height;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top');
}

export function edgePath(from: { x: number; y: number }, fromSide: Side, to: { x: number; y: number }, toSide: Side): string {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const k = Math.max(40, dist / 3);
  const c1 = { x: from.x + SIDE_NORMAL[fromSide].x * k, y: from.y + SIDE_NORMAL[fromSide].y * k };
  const c2 = { x: to.x + SIDE_NORMAL[toSide].x * k, y: to.y + SIDE_NORMAL[toSide].y * k };
  return `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`;
}

export interface Rect { x: number; y: number; width: number; height: number }

export const rectsIntersect = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export const rectContains = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x && inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

export function boundsOf(nodes: CanvasNode[]): Rect | null {
  if (nodes.length === 0) return null;
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + n.width));
  const maxY = Math.max(...nodes.map((n) => n.y + n.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Nodes fully inside a group's rectangle (the group carries them when moved). */
export function nodesInsideGroup(doc: CanvasDoc, group: CanvasNode): CanvasNode[] {
  return doc.nodes.filter((n) => n.id !== group.id && rectContains(group, n));
}

// --- z-order (array order is z-index per spec) -----------------------------------

export function bringToFront(doc: CanvasDoc, ids: ReadonlySet<string>): CanvasDoc {
  const rest = doc.nodes.filter((n) => !ids.has(n.id));
  const lifted = doc.nodes.filter((n) => ids.has(n.id));
  return { ...doc, nodes: [...rest, ...lifted] };
}

export function sendToBack(doc: CanvasDoc, ids: ReadonlySet<string>): CanvasDoc {
  const rest = doc.nodes.filter((n) => !ids.has(n.id));
  const sunk = doc.nodes.filter((n) => ids.has(n.id));
  return { ...doc, nodes: [...sunk, ...rest] };
}

// --- alignment & distribution -------------------------------------------------------

export type AlignMode = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';

export function alignNodes(doc: CanvasDoc, ids: ReadonlySet<string>, mode: AlignMode): CanvasDoc {
  const targets = doc.nodes.filter((n) => ids.has(n.id));
  const box = boundsOf(targets);
  if (!box || targets.length < 2) return doc;
  const place = (n: CanvasNode): number =>
    mode === 'left' ? box.x
    : mode === 'right' ? box.x + box.width - n.width
    : mode === 'centerX' ? box.x + (box.width - n.width) / 2
    : mode === 'top' ? box.y
    : mode === 'bottom' ? box.y + box.height - n.height
    : box.y + (box.height - n.height) / 2;
  const horizontal = mode === 'left' || mode === 'right' || mode === 'centerX';
  return {
    ...doc,
    nodes: doc.nodes.map((n) => (ids.has(n.id) ? { ...n, [horizontal ? 'x' : 'y']: Math.round(place(n)) } : n)),
  };
}

export function distributeNodes(doc: CanvasDoc, ids: ReadonlySet<string>, axis: 'x' | 'y'): CanvasDoc {
  const targets = doc.nodes.filter((n) => ids.has(n.id));
  if (targets.length < 3) return doc;
  const size = axis === 'x' ? 'width' : 'height';
  const sorted = [...targets].sort((a, b) => a[axis] - b[axis]);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = (last[axis] + last[size]) - first[axis];
  const total = sorted.reduce((s, n) => s + n[size], 0);
  const gap = (span - total) / (sorted.length - 1);
  const pos = new Map<string, number>();
  let cursor = first[axis];
  for (const n of sorted) { pos.set(n.id, Math.round(cursor)); cursor += n[size] + gap; }
  return { ...doc, nodes: doc.nodes.map((n) => (pos.has(n.id) ? { ...n, [axis]: pos.get(n.id)! } : n)) };
}

// --- clipboard fragments ----------------------------------------------------------

/**
 * A copyable fragment is itself a standard JSON Canvas document: the selected
 * nodes plus edges whose both endpoints are selected. Pastes anywhere,
 * including other tools.
 */
export function copyFragment(doc: CanvasDoc, ids: ReadonlySet<string>): string {
  const nodes = doc.nodes.filter((n) => ids.has(n.id));
  const edges = doc.edges.filter((e) => ids.has(e.fromNode) && ids.has(e.toNode));
  return serializeCanvas({ nodes, edges, extra: {} });
}

export interface PastedFragment {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  ids: Set<string>;
}

/**
 * Parse clipboard text as a JSON Canvas fragment, regenerate every id (so
 * repeated pastes never collide), remap edges, and translate so the
 * fragment's top-left lands at `at` (or offset by +24 when `at` is omitted).
 */
export function pasteFragment(text: string, at?: { x: number; y: number }): PastedFragment | null {
  const { doc } = parseCanvas(text);
  if (!doc || doc.nodes.length === 0) return null;
  const idMap = new Map<string, string>(doc.nodes.map((n) => [n.id, uid()]));
  const box = boundsOf(doc.nodes)!;
  const dx = at ? Math.round(at.x - box.x) : 24;
  const dy = at ? Math.round(at.y - box.y) : 24;
  const nodes = doc.nodes.map((n) => ({ ...n, id: idMap.get(n.id)!, x: n.x + dx, y: n.y + dy }));
  const edges = doc.edges
    .filter((e) => idMap.has(e.fromNode) && idMap.has(e.toNode))
    .map((e) => ({ ...e, id: uid(), fromNode: idMap.get(e.fromNode)!, toNode: idMap.get(e.toNode)! }));
  return { nodes, edges, ids: new Set(nodes.map((n) => n.id)) };
}

// --- neuron extension: versioned, namespaced style (v1) ---------------------------
//
// Rules (docs/plans/json-canvas-enhancements.md §2): standard fields stay
// authoritative — `color` is NOT duplicated here. A node gains a `neuron`
// object only when the user changes a nonstandard property, and loses it
// again when the last one is cleared. Unknown keys inside `neuron` and
// unsupported future versions are preserved verbatim and never edited.

export const NEURON_EXTENSION_VERSION = 1;

export interface NeuronCanvasStyle {
  shape?: 'rectangle' | 'rounded' | 'pill' | 'ellipse';
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  borderWidth?: number; // 0–8 px
  textAlign?: 'left' | 'center' | 'right';
  fontSize?: number; // 8–64 px
  opacity?: number; // 0.05–1
  preset?: string; // provenance only; concrete props are always written too
}

const STYLE_SHAPES = ['rectangle', 'rounded', 'pill', 'ellipse'] as const;
const STYLE_BORDERS = ['solid', 'dashed', 'dotted'] as const;
const STYLE_ALIGNS = ['left', 'center', 'right'] as const;

/** All style keys set to undefined — a "clear everything" patch. */
export const CLEAR_STYLE: Partial<NeuronCanvasStyle> = {
  shape: undefined, borderStyle: undefined, borderWidth: undefined,
  textAlign: undefined, fontSize: undefined, opacity: undefined, preset: undefined,
};

/**
 * Validated style for rendering. Malformed extensions, unsupported future
 * versions, and out-of-range values yield the standard fallback ({}); the
 * underlying data is left intact either way. Partial objects work — each
 * field is validated independently.
 */
export function getNodeStyle(node: CanvasNode): NeuronCanvasStyle {
  const neuron = node.neuron;
  if (!isObject(neuron) || neuron.version !== NEURON_EXTENSION_VERSION) return {};
  const raw = neuron.style;
  if (!isObject(raw)) return {};
  const out: NeuronCanvasStyle = {};
  if (STYLE_SHAPES.includes(raw.shape as never)) out.shape = raw.shape as NeuronCanvasStyle['shape'];
  if (STYLE_BORDERS.includes(raw.borderStyle as never)) out.borderStyle = raw.borderStyle as NeuronCanvasStyle['borderStyle'];
  if (STYLE_ALIGNS.includes(raw.textAlign as never)) out.textAlign = raw.textAlign as NeuronCanvasStyle['textAlign'];
  if (finite(raw.borderWidth) && raw.borderWidth >= 0 && raw.borderWidth <= 8) out.borderWidth = raw.borderWidth;
  if (finite(raw.fontSize) && raw.fontSize >= 8 && raw.fontSize <= 64) out.fontSize = raw.fontSize;
  if (finite(raw.opacity) && raw.opacity >= 0.05 && raw.opacity <= 1) out.opacity = raw.opacity;
  if (typeof raw.preset === 'string' && raw.preset.length <= 32) out.preset = raw.preset;
  return out;
}

/**
 * Merge a style patch (undefined deletes a key). Creates `neuron` lazily,
 * removes it entirely when nothing Neuron-owned remains, preserves unknown
 * sibling keys inside `neuron`, and refuses to touch extensions written by a
 * newer Neuron (unsupported `version`).
 */
export function setNodeStyle(node: CanvasNode, patch: Partial<NeuronCanvasStyle>): CanvasNode {
  const neuron = node.neuron;
  if (isObject(neuron) && neuron.version !== undefined && neuron.version !== NEURON_EXTENSION_VERSION) return node;
  const current = isObject(neuron) && isObject(neuron.style) ? neuron.style : {};
  const style: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete style[k];
    else style[k] = v;
  }
  const siblings = isObject(neuron) ? { ...neuron } : {};
  delete siblings.version;
  delete siblings.style;
  if (Object.keys(style).length === 0) {
    if (Object.keys(siblings).length === 0) {
      const { neuron: _removed, ...rest } = node;
      return rest as CanvasNode;
    }
    return { ...node, neuron: { version: NEURON_EXTENSION_VERSION, ...siblings } };
  }
  return { ...node, neuron: { version: NEURON_EXTENSION_VERSION, ...siblings, style } };
}

/** One-shot batch: style N selected nodes in a single new doc (= one undo entry). */
export function applyStyleToNodes(doc: CanvasDoc, ids: ReadonlySet<string>, patch: Partial<NeuronCanvasStyle>): CanvasDoc {
  return { ...doc, nodes: doc.nodes.map((n) => (ids.has(n.id) ? setNodeStyle(n, patch) : n)) };
}

/**
 * Named starter looks. Applying one writes the concrete style props (plus the
 * preset name as provenance) and, where given, the standard `color` — so
 * other JSON Canvas apps that ignore `neuron` still show the right color.
 * Presets never lock anything; every property stays individually editable.
 */
export const STYLE_PRESETS: Record<string, { style: Partial<NeuronCanvasStyle>; color?: string }> = {
  idea: { style: { shape: 'rounded', borderStyle: 'dashed' }, color: '3' },
  question: { style: { shape: 'pill', textAlign: 'center' }, color: '5' },
  warning: { style: { borderStyle: 'solid', borderWidth: 2 }, color: '2' },
  decision: { style: { shape: 'ellipse', textAlign: 'center' }, color: '6' },
};

export function applyStylePreset(doc: CanvasDoc, ids: ReadonlySet<string>, name: string): CanvasDoc {
  const preset = STYLE_PRESETS[name];
  if (!preset) return doc;
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (!ids.has(n.id)) return n;
      const styled = setNodeStyle(n, { ...CLEAR_STYLE, ...preset.style, preset: name });
      return preset.color ? { ...styled, color: preset.color } : styled;
    }),
  };
}

// --- misc ---------------------------------------------------------------------

/** JSON Canvas preset colors "1".."6"; anything else is treated as a CSS color. */
export const PRESET_COLORS: Record<string, string> = {
  '1': '#dd5c5c', '2': '#e28f44', '3': '#d9b23c', '4': '#5aa06c', '5': '#45a3a3', '6': '#9a6dd7',
};

export const colorOf = (c?: string): string | undefined => (c ? PRESET_COLORS[c] ?? c : undefined);

export function deleteSelection(doc: CanvasDoc, nodeIds: ReadonlySet<string>, edgeIds: ReadonlySet<string>): CanvasDoc {
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => !nodeIds.has(n.id)),
    edges: doc.edges.filter((e) => !edgeIds.has(e.id) && !nodeIds.has(e.fromNode) && !nodeIds.has(e.toNode)),
  };
}

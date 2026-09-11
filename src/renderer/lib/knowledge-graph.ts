import { MultiDirectedGraph } from 'graphology';
import { buildWikiIndex, resolveWikiLink } from './wikilinks';

export interface NoteData { path: string; content: string }
export type NodeKind = 'note' | 'canvas' | 'attachment' | 'unresolved';
export type EdgeKind = 'wikilink' | 'markdown-link' | 'embed' | 'canvas-reference';
export interface GraphNode { [key: string]: unknown; path: string; label: string; kind: NodeKind; degree: number; x: number; y: number }
export interface GraphEdge { [key: string]: unknown; kind: EdgeKind; weight: number }
export type Positions = Record<string, { x: number; y: number }>;
type Reference = { target: string; kind: EdgeKind; wiki: boolean };

function references(note: NoteData): Reference[] {
  if (note.path.endsWith('.canvas')) {
    try {
      const data = JSON.parse(note.content);
      return Array.isArray(data.nodes) ? data.nodes.flatMap((node: { file?: unknown }) =>
        typeof node?.file === 'string' ? [{ target: node.file, kind: 'canvas-reference' as const, wiki: false }] : []) : [];
    } catch { return []; }
  }
  if (!/\.mdx?$/i.test(note.path)) return [];
  const result: Reference[] = [];
  // Code examples are not relationships. This only reads content; it never renders it.
  const prose = note.content.replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, '').replace(/`[^`\n]*`/g, '');
  for (const match of prose.matchAll(/(!?)\[\[([^\]\n]+)\]\]|(!?)\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+[^)]*)?\)/g)) {
    const wiki = match[2] !== undefined;
    const target = (wiki ? match[2].split('|')[0] : match[4].replace(/^<|>$/g, '')).split('#')[0].trim();
    if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) continue;
    result.push({ target, wiki, kind: (wiki ? match[1] : match[3]) ? 'embed' : wiki ? 'wikilink' : 'markdown-link' });
  }
  return result;
}

function relativePath(source: string, target: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(target).replace(/\\/g, '/'); } catch { return null; }
  const parts = decoded.startsWith('/') ? [] : source.split('/').slice(0, -1);
  for (const part of decoded.split('/')) {
    if (part === '..') { if (!parts.length) return null; parts.pop(); }
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

/** Content is parsed once per change. Path changes re-resolve cached references,
 * because adding a duplicate basename can make an existing wiki-link ambiguous. */
export class KnowledgeGraph {
  graph = new MultiDirectedGraph<GraphNode, GraphEdge>();
  private notes = new Map<string, NoteData>();
  private refs = new Map<string, Reference[]>();
  parsed = 0;

  sync(notes: readonly NoteData[]): boolean {
    const next = new Map(notes.filter(n => !n.path.startsWith('.neuron/')).map(n => [n.path, n]));
    const pathChanged = next.size !== this.notes.size || [...next.keys()].some(id => !this.notes.has(id));
    const changed = [...next.values()].filter(n => this.notes.get(n.path)?.content !== n.content);
    if (!pathChanged && !changed.length) return false;
    for (const id of this.notes.keys()) if (!next.has(id)) {
      this.refs.delete(id);
      if (this.graph.hasNode(id)) this.graph.dropNode(id);
    }
    for (const note of changed) {
      this.refs.set(note.path, references(note));
      this.parsed++;
    }
    this.notes = next;
    for (const note of next.values()) if (!this.graph.hasNode(note.path)) this.addNode(note.path, /\.mdx?$/i.test(note.path) ? 'note' : note.path.endsWith('.canvas') ? 'canvas' : 'attachment');
    const wiki = buildWikiIndex([...next.keys()]);
    const paths = new Map([...next.keys()].map(path => [path.toLowerCase(), path]));
    const sources = pathChanged ? [...next.keys()] : changed.map(n => n.path);
    for (const source of sources) {
      for (const edge of this.graph.outEdges(source)) this.graph.dropEdge(edge);
      for (const ref of this.refs.get(source) ?? []) {
        const relative = relativePath(source, ref.target);
        const target = ref.wiki
          ? paths.get(ref.target.toLowerCase()) ?? resolveWikiLink(wiki, ref.target)
          : (relative && next.has(relative) ? relative : next.has(ref.target) ? ref.target : null);
        const id = target ?? `unresolved:${ref.wiki ? ref.target.toLowerCase() : relative ?? ref.target}`;
        if (id === source) continue;
        if (!this.graph.hasNode(id)) this.addNode(id, 'unresolved', ref.target);
        const edge = JSON.stringify([source, id, ref.kind]);
        if (!this.graph.hasEdge(edge)) this.graph.addDirectedEdgeWithKey(edge, source, id, { kind: ref.kind, weight: 1 });
      }
    }
    for (const id of this.graph.nodes()) {
      if (this.graph.getNodeAttribute(id, 'kind') === 'unresolved' && !this.graph.degree(id)) this.graph.dropNode(id);
      else this.graph.setNodeAttribute(id, 'degree', this.graph.degree(id));
    }
    return true;
  }

  private addNode(id: string, kind: NodeKind, label = id.replace(/\.(md|mdx)$/, '')) {
    this.graph.addNode(id, { path: id, label, kind, degree: 0, x: 0, y: 0 });
  }

  neighbours(id: string): string[] { return this.graph.hasNode(id) ? this.graph.neighbors(id) : []; }
  local(id: string, depth: number): Set<string> {
    const seen = new Set<string>();
    if (!this.graph.hasNode(id)) return seen;
    const queue: [string, number][] = [[id, 0]];
    seen.add(id);
    for (let i = 0; i < queue.length; i++) {
      const [node, distance] = queue[i];
      if (distance >= depth) continue;
      for (const neighbour of this.neighbours(node)) if (!seen.has(neighbour)) { seen.add(neighbour); queue.push([neighbour, distance + 1]); }
    }
    return seen;
  }
}

export function seedPositions(model: KnowledgeGraph, positions: Positions): string[] {
  const added: string[] = [];
  model.graph.forEachNode((id) => {
    const saved = positions[id];
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) model.graph.mergeNodeAttributes(id, saved);
    else added.push(id);
  });
  for (const id of added) {
    let hash = 2166136261;
    for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    const angle = (hash >>> 0) / 4294967296 * Math.PI * 2;
    const neighbours = model.neighbours(id).filter(n => positions[n]);
    const centre = neighbours.length ? neighbours.reduce((p, n) => ({ x: p.x + positions[n].x / neighbours.length, y: p.y + positions[n].y / neighbours.length }), { x: 0, y: 0 }) : { x: 0, y: 0 };
    const radius = neighbours.length ? 2 : 5 + Math.sqrt(model.graph.order) * ((hash >>> 8 & 255) / 255);
    const point = { x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius };
    model.graph.mergeNodeAttributes(id, point);
    positions[id] = point;
  }
  return added;
}

export const GRAPH_DEFAULTS = { gravity: 1, repel: 3, attraction: 1, distance: 1, nodeSize: 4, linkThickness: 1, labelThreshold: 1, arrows: false, orphans: true, unresolved: true, local: false, depth: 1 };
export type GraphPreferences = typeof GRAPH_DEFAULTS;
export const GRAPH_RANGES = { gravity: [0.05, 5, 0.05], repel: [0.1, 10, 0.1], attraction: [0.1, 5, 0.1], distance: [0.25, 4, 0.05], nodeSize: [1, 10, 0.5], linkThickness: [0.2, 4, 0.2], labelThreshold: [0.1, 3, 0.1], depth: [1, 5, 1] } as const;
export function graphPreferences(value: unknown): GraphPreferences {
  const result = { ...GRAPH_DEFAULTS };
  if (!value || typeof value !== 'object') return result;
  for (const key of Object.keys(result) as (keyof GraphPreferences)[]) {
    const item = (value as Record<string, unknown>)[key];
    if (key in GRAPH_RANGES) {
      const [min, max] = GRAPH_RANGES[key as keyof typeof GRAPH_RANGES];
      if (typeof item === 'number' && Number.isFinite(item)) Object.assign(result, { [key]: Math.max(min, Math.min(max, key === 'depth' ? Math.round(item) : item)) });
    } else if (typeof item === 'boolean') Object.assign(result, { [key]: item });
  }
  return result;
}

export function physicsSettings(p: GraphPreferences) {
  return { gravity: p.gravity, scalingRatio: p.repel * p.distance * p.distance, edgeWeightInfluence: 1, slowDown: 8, barnesHutOptimize: true, barnesHutTheta: 0.5, strongGravityMode: true };
}

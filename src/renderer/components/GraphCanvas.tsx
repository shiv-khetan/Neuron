import { useMemo } from 'react';

interface NoteData {
  path: string;
  content: string;
}

interface PlacedNode {
  id: string;
  label: string;
  x: number;
  y: number;
}

interface Link {
  source: string;
  target: string;
}

interface GraphCanvasProps {
  /** Notes to map. Nodes are these notes; links are wiki-links between them. */
  notesData: NoteData[];
  onSelectNote: (note: string) => void;
  selectedNote: string | null;
  /** Optional empty-state hint. */
  emptyHint?: string;
}

const HEX = 46; // distance unit between hex cells

/**
 * Axial hex-spiral coordinates for `count` cells, starting at the center and
 * winding outward ring by ring. Deterministic — the layout is identical every
 * render, so the graph is stable from the first frame (no force simulation).
 */
function hexSpiral(count: number): Array<{ q: number; r: number }> {
  const dirs = [
    [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
  ];
  const cells: Array<{ q: number; r: number }> = [{ q: 0, r: 0 }];
  let ring = 1;
  while (cells.length < count) {
    // Start each ring at the corner `ring` steps along direction 4.
    let q = dirs[4][0] * ring;
    let r = dirs[4][1] * ring;
    for (let side = 0; side < 6 && cells.length < count; side++) {
      for (let step = 0; step < ring && cells.length < count; step++) {
        cells.push({ q, r });
        q += dirs[side][0];
        r += dirs[side][1];
      }
    }
    ring++;
  }
  return cells;
}

/**
 * Static hex-grid wiki-link graph. Nodes sit on a honeycomb lattice and never
 * move; links are straight lines between them.
 */
export default function GraphCanvas({ notesData, onSelectNote, selectedNote, emptyHint }: GraphCanvasProps) {
  const { nodes, links, viewBox } = useMemo(() => {
    const cells = hexSpiral(notesData.length);
    const placed: PlacedNode[] = notesData.map((note, i) => {
      const { q, r } = cells[i];
      // Axial → pixel (pointy-top hexagons).
      const x = HEX * Math.sqrt(3) * (q + r / 2);
      const y = HEX * 1.5 * r;
      return { id: note.path, label: note.path.replace(/\.(md|mdx)$/, ''), x, y };
    });

    const byLabel = new Map<string, string>();
    placed.forEach((n) => {
      byLabel.set(n.label.toLowerCase(), n.id);
      const base = n.label.split('/').pop()!.toLowerCase();
      if (!byLabel.has(base)) byLabel.set(base, n.id);
    });

    const computedLinks: Link[] = [];
    notesData.forEach((note) => {
      const re = /\[\[(.*?)\]\]/g;
      let match;
      while ((match = re.exec(note.content)) !== null) {
        const target = byLabel.get(match[1].trim().toLowerCase());
        if (target && target !== note.path) computedLinks.push({ source: note.path, target });
      }
    });

    // Fit the viewBox to the placed nodes with padding for radius + labels.
    const pad = 70;
    const xs = placed.map((n) => n.x);
    const ys = placed.map((n) => n.y);
    const minX = Math.min(0, ...xs) - pad;
    const minY = Math.min(0, ...ys) - pad;
    const w = Math.max(...xs, 0) - Math.min(...xs, 0) + pad * 2 || 200;
    const h = Math.max(...ys, 0) - Math.min(...ys, 0) + pad * 2 || 200;

    return { nodes: placed, links: computedLinks, viewBox: `${minX} ${minY} ${w} ${h}` };
  }, [notesData]);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  return (
    <div className="relative h-full w-full select-none">
      <svg className="h-full w-full" viewBox={viewBox} preserveAspectRatio="xMidYMid meet">
        {links.map((link, idx) => {
          const s = nodeById.get(link.source);
          const t = nodeById.get(link.target);
          if (!s || !t) return null;
          return <line key={`link-${idx}`} x1={s.x} y1={s.y} x2={t.x} y2={t.y} className="stroke-slate-700 stroke-[1.25px]" />;
        })}

        {nodes.map((node) => {
          const isSelected = selectedNote === node.id;
          return (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              className="graph-node group cursor-pointer"
              role="button"
              tabIndex={0}
              aria-label={`Open ${node.label}`}
              onClick={() => onSelectNote(node.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectNote(node.id);
                }
              }}
            >
              <circle
                r={isSelected ? 10 : 6}
                className={`interactive ${
                  isSelected
                    ? 'fill-emerald-400/20 stroke-emerald-300 stroke-2'
                    : 'fill-slate-900 stroke-slate-600 stroke-1 group-hover:fill-emerald-400/10 group-hover:stroke-emerald-300'
                }`}
              />
              <circle r={isSelected ? 4 : 2} className={isSelected ? 'fill-emerald-300' : 'fill-slate-400 group-hover:fill-emerald-300'} />
              <text
                y={-14}
                className={`pointer-events-none select-none text-center font-mono text-[9px] font-medium ${
                  isSelected ? 'fill-emerald-300' : 'fill-slate-500 group-hover:fill-slate-200'
                }`}
                textAnchor="middle"
              >
                {node.label.split('/').pop()}
              </text>
            </g>
          );
        })}
      </svg>
      {nodes.length === 0 && (
        <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-[var(--ink-muted)]">
          {emptyHint ?? 'Create two linked notes to map their relationship.'}
        </div>
      )}
    </div>
  );
}

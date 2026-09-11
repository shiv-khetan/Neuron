import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const tmp = resolve('.knowledge-graph.tmp.cjs');
await build({ entryPoints: ['src/renderer/lib/knowledge-graph.ts'], bundle: true, format: 'cjs', platform: 'node', outfile: tmp, logLevel: 'silent' });
const { KnowledgeGraph, seedPositions, graphPreferences, GRAPH_DEFAULTS } = await import(pathToFileURL(tmp));
rmSync(tmp);
const notes = [
  { path: 'a.md', content: '[[folder/b|Alias]] [[Missing]] [[same]] [B](folder/b.md#heading) ![[image.png]]\n```md\n[[not-a-link]]\n```' },
  { path: 'folder/b.md', content: '[[a]] [[c]]' },
  { path: 'c.md', content: '[[a]]' },
  { path: 'one/same.md', content: '' },
  { path: 'two/same.md', content: '' },
  { path: 'image.png', content: '' },
  { path: 'board.canvas', content: JSON.stringify({ nodes: [{ type: 'file', file: 'folder/b.md' }] }) },
];
const m = new KnowledgeGraph();
assert.equal(m.sync(notes), true);
assert.equal(m.graph.order, 9);
assert.equal(m.graph.hasNode('unresolved:same'), true);
assert.equal(m.graph.hasNode('unresolved:not-a-link'), false);
assert.equal(m.graph.getNodeAttribute('image.png', 'kind'), 'attachment');
assert.equal(m.graph.getNodeAttribute('board.canvas', 'kind'), 'canvas');
assert.deepEqual(new Set(m.graph.outNeighbors('a.md')), new Set(['folder/b.md', 'unresolved:missing', 'unresolved:same', 'image.png']));
assert.equal(m.graph.outEdges('a.md', 'folder/b.md').length, 2);
assert.deepEqual(m.local('c.md', 1), new Set(['c.md', 'a.md', 'folder/b.md']));
const parsed = m.parsed;
assert.equal(m.sync(notes), false);
assert.equal(m.parsed, parsed);
const positions = Object.create(null);
seedPositions(m, positions);
const saved = structuredClone(positions);
m.sync([...notes, { path: 'new.md', content: '[[a]]' }]);
assert.deepEqual(seedPositions(m, positions), ['new.md']);
for (const id of Object.keys(saved)) assert.deepEqual({ x: m.graph.getNodeAttribute(id, 'x'), y: m.graph.getNodeAttribute(id, 'y') }, saved[id]);
assert.ok(Math.hypot(positions['new.md'].x - positions['a.md'].x, positions['new.md'].y - positions['a.md'].y) < 2.01);
m.sync(notes.map(n => n.path === 'c.md' ? { ...n, content: '[[folder/b]]' } : n));
assert.equal(m.parsed, parsed + 2);
m.sync(notes.filter(n => n.path !== 'two/same.md'));
assert.equal(m.graph.hasNode('unresolved:same'), false);
assert.ok(m.graph.hasDirectedEdge('a.md', 'one/same.md'));
m.sync([...notes, { path: 'Missing.md', content: '' }]);
assert.equal(m.graph.hasNode('unresolved:missing'), false);
assert.ok(m.graph.hasDirectedEdge('a.md', 'Missing.md'));
assert.deepEqual(graphPreferences(null), GRAPH_DEFAULTS);
assert.equal(graphPreferences({ depth: 99, repel: NaN, arrows: 'yes' }).depth, 5);
assert.equal(graphPreferences({ repel: NaN }).repel, GRAPH_DEFAULTS.repel);
console.log('knowledge graph: resolution, incremental updates, traversal, stability, validation passed');

// Exercise the actual library worker in Node with only its messaging transport
// adapted to worker_threads. Physics and our settling controller are unchanged.
const { Worker: Thread } = await import('node:worker_threads');
const workerTmp = resolve('.graph-layout.tmp.cjs');
await build({ entryPoints: ['src/renderer/lib/graph-layout.ts'], bundle: true, format: 'cjs', platform: 'node', outfile: workerTmp, logLevel: 'silent' });
const { settleLayout } = await import(pathToFileURL(workerTmp));
rmSync(workerTmp);
const blobs = new Map();
globalThis.Blob = class { constructor(parts) { this.code = parts.join(''); } };
globalThis.window = { URL: { createObjectURL(blob) { const id = String(blobs.size); blobs.set(id, blob.code); return id; }, revokeObjectURL() {} } };
globalThis.Worker = class {
  constructor(url) {
    this.listeners = new Map();
    this.thread = new Thread(`const { parentPort } = require('node:worker_threads'); globalThis.self = { addEventListener: (_, fn) => parentPort.on('message', data => fn({ data })), postMessage: (data, transfers) => parentPort.postMessage(data, transfers) }; ${blobs.get(url)}`, { eval: true });
  }
  addEventListener(_event, listener) { const wrapped = data => listener({ data }); this.listeners.set(listener, wrapped); this.thread.on('message', wrapped); }
  removeEventListener(_event, listener) { this.thread.off('message', this.listeners.get(listener)); }
  postMessage(data, transfer) { this.thread.postMessage(data, transfer); }
  terminate() { void this.thread.terminate(); }
};
const moving = new KnowledgeGraph();
moving.sync([{ path: 'anchor.md', content: '[[new]]' }, { path: 'new.md', content: '' }]);
const points = { 'anchor.md': { x: 2.123456789, y: -3.987654321 } };
seedPositions(moving, points);
const beforeMoving = { ...points['new.md'] };
let updates = 0;
moving.graph.on('eachNodeAttributesUpdated', () => updates++);
await new Promise(resolve => settleLayout(moving, GRAPH_DEFAULTS, resolve, new Set(['new.md'])));
assert.deepEqual({ x: moving.graph.getNodeAttribute('anchor.md', 'x'), y: moving.graph.getNodeAttribute('anchor.md', 'y') }, points['anchor.md'], 'saved node survives worker float32 round-trip exactly');
assert.notDeepEqual({ x: moving.graph.getNodeAttribute('new.md', 'x'), y: moving.graph.getNodeAttribute('new.md', 'y') }, beforeMoving, 'new node settles using real ForceAtlas2');
assert.ok(updates > 0 && updates <= 120);
const stoppedAt = updates;
await new Promise(resolve => setTimeout(resolve, 100));
assert.equal(updates, stoppedAt, 'worker is terminated after settling');
console.log('knowledge graph: actual ForceAtlas2 worker preserves anchors and terminates');

import { build } from 'esbuild';
import { rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { cpus, platform, release } from 'node:os';
import forceAtlas2 from 'graphology-layout-forceatlas2';
const tmp = resolve('.graph-benchmark.tmp.cjs');
await build({ entryPoints: ['src/renderer/lib/knowledge-graph.ts'], bundle: true, format: 'cjs', platform: 'node', outfile: tmp, logLevel: 'silent' });
const { KnowledgeGraph, seedPositions, GRAPH_DEFAULTS, physicsSettings } = await import(pathToFileURL(tmp));
rmSync(tmp);
const results = [];
for (const count of [100, 1000, 5000, 10000]) {
  const samples = [];
  for (let run = 0; run < 5; run++) {
    const notes = Array.from({ length: count }, (_, i) => ({ path: `note-${i}.md`, content: `[[note-${(i+1)%count}]] [[note-${(i*7+13)%count}]]` }));
    const memoryBefore = process.memoryUsage().heapUsed;
    const begin = performance.now();
    const model = new KnowledgeGraph(); model.sync(notes);
    const indexMs = performance.now() - begin;
    const start = performance.now(); seedPositions(model, Object.create(null));
    const seedMs = performance.now() - start;
    const layout = performance.now(); forceAtlas2.assign(model.graph, { iterations: 1, settings: physicsSettings(GRAPH_DEFAULTS) });
    const iterationMs = performance.now() - layout;
    const update = performance.now(); model.sync(notes.map((n, i) => i === 0 ? { ...n, content: '[[note-3]]' } : n));
    samples.push({ indexMs, seedMs, iterationMs, incrementalMs: performance.now() - update, heapDeltaMiB: (process.memoryUsage().heapUsed - memoryBefore)/1048576 });
  }
  results.push({ nodes: count, ...Object.fromEntries(Object.keys(samples[0]).map(key => [key, Number(samples.map(s => s[key]).sort((a,b)=>a-b)[2].toFixed(2))])) });
}
const report = { date: new Date().toISOString(), platform: `${platform()} ${release()}`, cpu: cpus()[0].model, method: 'Five runs; medians. Synthetic notes with two outgoing wiki-links. Heap delta is noisy, no forced GC. Iteration includes FA2 matrix construction; not settled layout time. Interactive metrics require graph-benchmark.html or the Electron benchmark spec.', results };
writeFileSync('graph-benchmark-results.json', JSON.stringify(report, null, 2));
console.table(results);

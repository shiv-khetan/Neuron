import Sigma from 'sigma';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { KnowledgeGraph, seedPositions, GRAPH_DEFAULTS, physicsSettings } from './src/renderer/lib/knowledge-graph';
import { settleLayout } from './src/renderer/lib/graph-layout';
const host = document.querySelector<HTMLDivElement>('#graph')!;
const output = document.querySelector('#results')!;
const frame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));
const median = (xs: number[]) => [...xs].sort((a,b)=>a-b)[Math.floor(xs.length / 2)];
async function run() {
  const reports = [];
  for (const count of [100, 1000, 5000, 10000]) {
    output.textContent = `Measuring ${count} nodes…`;
    const notes = Array.from({ length: count }, (_, i) => ({ path: `note-${i}.md`, content: `[[note-${(i + 1) % count}]] [[note-${(i * 7 + 13) % count}]]` }));
    const t = performance.now(); const model = new KnowledgeGraph(); model.sync(notes);
    const indexMs = performance.now() - t;
    const seed = performance.now(); seedPositions(model, Object.create(null));
    const seedMs = performance.now() - seed;
    const init = performance.now();
    const sigma = new Sigma(model.graph, host, {
      labelSize: 11, labelDensity: 0.7, labelRenderedSizeThreshold: 0,
      defaultNodeColor: '#838b99', defaultEdgeColor: '#555b66',
      nodeReducer: (_id, a) => ({ ...a, size: 4 + Math.min(7, Math.sqrt(a.degree) * 1.2) }),
    });
    await frame(); await frame();
    const firstInteractiveFrameMs = performance.now() - init;
    const deltas: number[] = [];
    let previous = performance.now();
    const begin = previous;
    let tick = 0;
    while (performance.now() - begin < 1500) {
      const now = await frame(); deltas.push(now - previous); previous = now;
      sigma.getCamera().setState({ x: 0.5 + Math.sin(tick / 20) * 0.1, ratio: 0.8 + Math.cos(tick++ / 20) * 0.15 });
    }
    const panZoomFPS = deltas.length * 1000 / (performance.now() - begin);
    const dragMs: number[] = [];
    for (let i = 0; i < 30; i++) {
      await frame();
      const start = performance.now();
      const rendered = new Promise<void>(resolve => sigma.once('afterRender', () => resolve()));
      model.graph.mergeNodeAttributes('note-0.md', { x: i * 0.1, y: i * 0.1 });
      await rendered; dragMs.push(performance.now() - start);
    }
    // Compare UI scheduling while the same layout runs on-thread and in-worker.
    const blocking = performance.now(); forceAtlas2.assign(model.graph, { iterations: 5, settings: physicsSettings(GRAPH_DEFAULTS) });
    const syncFiveIterationsMs = performance.now() - blocking;
    let ended = false;
    const startWorker = performance.now();
    const stop = settleLayout(model, GRAPH_DEFAULTS, () => { ended = true; });
    const workerInitMs = performance.now() - startWorker;
    const workerFrames: number[] = [];
    previous = performance.now();
    while (!ended) { const now = await frame(); workerFrames.push(now - previous); previous = now; }
    stop();
    const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
    reports.push({ nodes: count, indexMs, seedMs, firstInteractiveFrameMs, panZoomFPS, panZoomFrameP95Ms: [...deltas].sort((a,b)=>a-b)[Math.floor(deltas.length * .95)], dragUpdateToRenderMedianMs: median(dragMs), syncFiveIterationsMs, workerInitMs, workerFrameMedianMs: median(workerFrames), workerElapsedMs: performance.now() - startWorker, heapMiB: heap ? heap / 1048576 : null });
    sigma.kill();
  }
  output.textContent = JSON.stringify({ userAgent: navigator.userAgent, devicePixelRatio, method: 'One browser run per size, 700×500 CSS px; camera updates on rAF for 1.5s; 30 synthetic node coordinate updates to afterRender; worker capped at 2.5s/120 iterations.', reports }, null, 2);
  document.body.dataset.complete = 'true';
}
document.querySelector<HTMLButtonElement>('#run')!.onclick = () => { void run().catch(error => { output.textContent = String(error.stack ?? error); }); };

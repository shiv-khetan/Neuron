import FA2Layout from 'graphology-layout-forceatlas2/worker';
import { type KnowledgeGraph, type GraphPreferences, type Positions, physicsSettings } from './knowledge-graph';

/** The library worker owns physics; this controller only bounds its lifetime. */
export function settleLayout(model: KnowledgeGraph, preferences: GraphPreferences, done: () => void, movable?: Set<string>) {
  const graph = model.graph;
  if (!graph.order) { done(); return () => {}; }
  graph.forEachEdge(edge => graph.setEdgeAttribute(edge, 'weight', preferences.attraction));
  let ticks = 0, quiet = 0, stopped = false;
  const previous: Positions = Object.create(null);
  graph.forEachNode((id, a) => { previous[id] = { x: a.x, y: a.y }; });
  const layout = new FA2Layout(graph, {
    settings: physicsSettings(preferences),
    outputReducer: (id, attrs) => {
      const old = previous[id];
      if ((movable && !movable.has(id)) || graph.getNodeAttribute(id, 'fixed') || !Number.isFinite(attrs.x) || !Number.isFinite(attrs.y)) return { ...attrs, x: old.x, y: old.y };
      return attrs;
    },
  });
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timeout); graph.off('eachNodeAttributesUpdated', changed); layout.kill(); done();
  };
  const changed = () => {
    let displacement = 0;
    graph.forEachNode((id, a) => {
      const before = previous[id];
      displacement = Math.max(displacement, Math.hypot(a.x - before.x, a.y - before.y));
      previous[id] = { x: a.x, y: a.y };
    });
    quiet = displacement < 0.02 ? quiet + 1 : 0;
    if (++ticks >= 120 || quiet >= 6) queueMicrotask(stop);
  };
  const timeout = setTimeout(stop, 2500);
  graph.on('eachNodeAttributesUpdated', changed); layout.start();
  return stop;
}

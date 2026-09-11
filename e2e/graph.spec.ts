import { test, expect, openNote } from './fixtures';
import type { Locator } from '@playwright/test';

// T-026. The graph is a floating square over the editor, on by default, drawing
// the whole workspace -- not a full-height column showing the active note alone.

/**
 * Wait until Sigma has actually painted a frame.
 *
 * Sigma hit-tests a pointer against what it has DRAWN, not against the graph
 * model. `data-layout-running="false"` says the physics finished; it says
 * nothing about the renderer having caught up. On a machine with a GPU the two
 * are close enough that the difference never shows, but CI has no GPU and runs
 * on SwiftShader, where the paint lands later -- so a mouse press computed from
 * `graphToViewport` arrived before the renderer knew where anything was, and
 * `downNode` never fired. The node was exactly where the test thought; Sigma
 * had simply not drawn it yet.
 */
const painted = (canvas: Locator) => canvas.evaluate((el: any) => new Promise<void>((resolve) => {
  if (!el.sigma) { resolve(); return; }
  el.sigma.once('afterRender', () => resolve());
  el.sigma.refresh();
}));

test('the graph is visible without touching a shortcut', async ({ page }) => {
  // No keypress, no focus juggling. It is on by default because it replaced a
  // panel that was always on; a graph you must discover a shortcut for is a
  // graph nobody sees. This also sidesteps the real problem that a global
  // keydown handler does nothing while the terminal or a webview holds focus.
  const graph = page.getByRole('complementary', { name: 'Workspace graph' });
  await expect(graph).toBeVisible();

  const box = await graph.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box!.width - box!.height)).toBeLessThan(2);
  expect(box!.width).toBeLessThan(320);

  // It must clear the tab strip rather than sit on top of it.
  const tabs = await page.locator('nav[aria-label="Open notes"]').boundingBox();
  if (tabs) expect(box!.y).toBeGreaterThanOrEqual(tabs.y + tabs.height - 1);

  // No title bar: the square is all graph, with only the close control on it.
  await expect(graph).not.toContainText('Graph');
  await expect(graph.getByRole('button', { name: 'Hide graph' })).toBeVisible();
});

test('the graph draws every note using Sigma WebGL', async ({ page }) => {
  const canvas = page.locator('[data-graph-canvas]').first();
  await expect(canvas.locator('canvas.sigma-nodes')).toBeVisible();
  await expect.poll(() => canvas.evaluate((el: any) => el.sigma?.getGraph().order ?? 0)).toBeGreaterThan(5);
  await expect.poll(() => canvas.evaluate((el: any) => el.sigma?.getGraph().order ?? 0)).toBeGreaterThan(5);
  expect(await canvas.evaluate((el: any) => el.sigma.getGraph().nodes().every((id: string) => !el.sigma.getNodeDisplayData(id).hidden))).toBe(true);
});

test('the graph sits over the editor and can be dismissed', async ({ page }) => {
  const graph = page.getByRole('complementary', { name: 'Workspace graph' });
  await expect(graph).toBeVisible();
  await graph.getByRole('button', { name: 'Hide graph' }).click();
  await expect(graph).toHaveCount(0);
});

test('no full-height graph column remains in the shell layout', async ({ page, workspace }) => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const layout = JSON.parse(readFileSync(join(workspace, '.neuron', 'layout.json'), 'utf-8'));
  const panels = JSON.stringify(layout);
  expect(panels).not.toContain('"graph"');
  // The editor gets the width back: it is the only panel besides the terminal.
  expect(panels).toContain('"editor"');
  expect(panels).toContain('"terminal"');
  // And the floating graph is what shows the workspace instead.
  await expect(page.getByRole('complementary', { name: 'Workspace graph' })).toBeVisible();
});

test('the graph recentres on the open note, zooms, and pans', async ({ page }) => {
  const canvas = page.locator('[data-graph-canvas]').first();
  await expect(canvas.locator('canvas.sigma-nodes')).toBeVisible();
  await expect.poll(() => canvas.evaluate((el: any) => el.sigma?.getGraph().order ?? 0)).toBeGreaterThan(5);
  await expect(page.locator('[data-graph-root]').first()).toHaveAttribute('data-layout-running', 'false');
  await openNote(page, 'guides/markdown-basics');
  await expect.poll(() => canvas.evaluate((el: any) => {
    const s = el.sigma, g = s.getGraph();
    const id = g.nodes().find((id: string) => id.includes('guides/markdown-basics'));
    const p = s.graphToViewport(g.getNodeAttributes(id));
    return Math.hypot(p.x - el.clientWidth / 2, p.y - el.clientHeight / 2);
  })).toBeLessThan(24);
  const before = await canvas.evaluate((el: any) => el.sigma.getCamera().ratio);
  const rect = (await canvas.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.wheel(0, -240);
  await expect.poll(() => canvas.evaluate((el: any) => el.sigma.getCamera().ratio)).toBeLessThan(before);
  const camera = await canvas.evaluate((el: any) => el.sigma.getCamera().getState());
  await page.mouse.move(rect.x + 12, rect.y + rect.height - 12);
  await page.mouse.down();
  await page.mouse.move(rect.x + 72, rect.y + rect.height - 52, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => canvas.evaluate((el: any) => el.sigma.getCamera().x)).not.toBe(camera.x);
});

test('the graph can be closed and reopened from the title bar', async ({ page }) => {
  const graph = page.getByRole('complementary', { name: 'Workspace graph' });
  await expect(graph).toBeVisible();

  await graph.getByRole('button', { name: 'Hide graph' }).click();
  await expect(graph).toHaveCount(0);

  // Closing must not be one-way. The palette entry and Ctrl+Shift+G both run
  // through a global keydown with no focus scopes, so neither fires while the
  // terminal or a webview holds focus -- a persistent control is the only way
  // back that always works.
  await page.getByRole('button', { name: 'Show graph' }).click();
  await expect(graph).toBeVisible();
});

test('the graph panel can be dragged to a new position', async ({ page }) => {
  const graph = page.getByRole('complementary', { name: 'Workspace graph' });
  const before = (await graph.boundingBox())!;

  // The grip, not the canvas: dragging the canvas pans the graph, so moving the
  // window needs its own affordance.
  const grip = graph.getByRole('button', { name: 'Move graph' });
  const g = (await grip.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 - 180, g.y + g.height / 2 + 120, { steps: 10 });
  await page.mouse.up();

  const after = (await graph.boundingBox())!;
  expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(40);
  // Still fully inside the editor region -- a panel dragged off-screen cannot
  // be dragged back.
  expect(after.x).toBeGreaterThan(0);
  expect(after.y).toBeGreaterThan(0);
});

test('opening notes preserves layout coordinates; reopening restores positions', async ({ page }) => {
  const graph = page.getByRole('complementary', { name: 'Workspace graph' });
  const canvas = graph.locator('[data-graph-canvas]');
  await expect(canvas.locator('canvas.sigma-nodes')).toBeVisible();
  await expect.poll(() => canvas.evaluate((el: any) => el.sigma?.getGraph().order ?? 0)).toBeGreaterThan(5);
  await expect(graph.locator('[data-graph-root]')).toHaveAttribute('data-layout-running', 'false');
  const snapshot = () => canvas.evaluate((el: any) => Object.fromEntries(el.sigma.getGraph().mapNodes((id: string, a: any) => [id, { x: a.x, y: a.y }])));
  const before = await snapshot();
  await openNote(page, 'guides/markdown-basics');
  expect(await snapshot()).toEqual(before);
  await graph.getByRole('button', { name: 'Hide graph' }).click();
  await page.getByRole('button', { name: 'Show graph' }).click();
  await expect(canvas.locator('canvas.sigma-nodes')).toBeVisible();
  await expect.poll(() => canvas.evaluate((el: any) => el.sigma?.getGraph().order ?? 0)).toBeGreaterThan(5);
  await expect.poll(snapshot).toEqual(before);
});

test('local depth and display settings persist without moving shared nodes', async ({ page }) => {
  const graph = page.getByRole('complementary', { name: 'Workspace graph' });
  const canvas = graph.locator('[data-graph-canvas]');
  await expect(canvas.locator('canvas.sigma-nodes')).toBeVisible();
  await expect.poll(() => canvas.evaluate((el: any) => el.sigma?.getGraph().order ?? 0)).toBeGreaterThan(5);
  await expect(graph.locator('[data-graph-root]')).toHaveAttribute('data-layout-running', 'false');
  await openNote(page, 'guides/markdown-basics');
  const before = await canvas.evaluate((el: any) => el.sigma.getGraph().export());
  await graph.getByRole('button', { name: 'Connection settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Connection settings' });
  await settings.getByRole('button', { name: 'Local', exact: true }).click();
  await settings.getByRole('slider', { name: 'Local depth' }).fill('2');
  await settings.getByLabel('Show arrows').check();
  await settings.getByRole('button', { name: 'Close connection settings' }).click();
  expect(await canvas.evaluate((el: any) => el.sigma.getGraph().export())).toEqual(before);
  await graph.getByRole('button', { name: 'Hide graph' }).click();
  await page.getByRole('button', { name: 'Show graph' }).click();
  await expect(canvas.locator('canvas.sigma-nodes')).toBeVisible();
  await expect.poll(() => canvas.evaluate((el: any) => el.sigma?.getGraph().order ?? 0)).toBeGreaterThan(5);
  await graph.getByRole('button', { name: 'Connection settings' }).click();
  await expect(settings.getByRole('button', { name: 'Local', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(settings.getByRole('slider', { name: 'Local depth' })).toHaveValue('2');
  await expect(settings.getByLabel('Show arrows')).toBeChecked();
});

test('nodes can be dragged and the layout stops after reheating', async ({ page }) => {
  const canvas = page.locator('[data-graph-canvas]').first();
  await expect.poll(() => canvas.evaluate((el: any) => el.sigma?.getGraph().order ?? 0)).toBeGreaterThan(5);
  await expect(page.locator('[data-graph-root]').first()).toHaveAttribute('data-layout-running', 'false');
  await painted(canvas);
  const rect = (await canvas.boundingBox())!;
  const target = await canvas.evaluate((el: any) => {
    const s = el.sigma, g = s.getGraph();
    return g.nodes().map((id: string) => ({ id, ...s.graphToViewport(g.getNodeAttributes(id)), point: { x: g.getNodeAttribute(id, 'x'), y: g.getNodeAttribute(id, 'y') } }))
      .find((n: any) => n.x > 30 && n.x < el.clientWidth - 50 && n.y > 50 && n.y < el.clientHeight - 40);
  });
  expect(target).toBeTruthy();
  await page.mouse.move(rect.x + target.x, rect.y + target.y);
  await page.mouse.down();
  await page.mouse.move(rect.x + target.x + 30, rect.y + target.y + 20, { steps: 10 });
  const during = await canvas.evaluate((el: any) => {
    const g = el.sigma.getGraph();
    const id = g.nodes().find((id: string) => g.getNodeAttribute(id, 'fixed'));
    return id ? { x: g.getNodeAttribute(id, 'x'), y: g.getNodeAttribute(id, 'y') } : null;
  });
  expect(during).not.toEqual(target.point);
  expect(during).not.toBeNull();
  await page.mouse.up();
  await expect(page.locator('[data-graph-root]').first()).toHaveAttribute('data-layout-running', 'false');
  const before = await canvas.evaluate((el: any) => el.sigma.getGraph().export());
  await page.waitForTimeout(200);
  expect(await canvas.evaluate((el: any) => el.sigma.getGraph().export())).toEqual(before);
});

test('file changes update relationships and resolve missing targets', async ({ page, workspace }) => {
  const { writeFileSync, unlinkSync } = await import('node:fs');
  const { join } = await import('node:path');
  const canvas = page.locator('[data-graph-canvas]').first();
  await expect.poll(() => canvas.evaluate((el: any) => el.sigma?.getGraph().order ?? 0)).toBeGreaterThan(5);
  writeFileSync(join(workspace, 'graph-source.md'), '[[graph-target]]');
  await expect.poll(() => canvas.evaluate((el: any) => el.sigma.getGraph().hasNode('unresolved:graph-target'))).toBe(true);
  writeFileSync(join(workspace, 'graph-target.md'), '# Target');
  await expect.poll(() => canvas.evaluate((el: any) => el.sigma.getGraph().hasDirectedEdge('graph-source.md', 'graph-target.md'))).toBe(true);
  await expect.poll(() => canvas.evaluate((el: any) => el.sigma.getGraph().hasNode('unresolved:graph-target'))).toBe(false);
  unlinkSync(join(workspace, 'graph-target.md'));
  await expect.poll(() => canvas.evaluate((el: any) => el.sigma.getGraph().hasNode('unresolved:graph-target'))).toBe(true);
});

test('clicking a node animates the camera through intermediate positions', async ({ page }) => {
  const canvas = page.locator('[data-graph-canvas]').first();
  await expect.poll(() => canvas.evaluate((el: any) => el.sigma?.getGraph().order ?? 0)).toBeGreaterThan(5);
  await expect(page.locator('[data-graph-root]').first()).toHaveAttribute('data-layout-running', 'false');
  await painted(canvas);
  const rect = (await canvas.boundingBox())!;
  const target = await canvas.evaluate((el: any) => {
    const s = el.sigma, g = s.getGraph();
    return g.nodes().filter((id: string) => g.getNodeAttribute(id, 'kind') === 'note')
      .map((id: string) => ({ id, ...s.graphToViewport(g.getNodeAttributes(id)) }))
      .find((n: any) => n.x > 25 && n.x < el.clientWidth - 25 && n.y > 50 && n.y < el.clientHeight - 25 && Math.hypot(n.x - el.clientWidth/2, n.y - el.clientHeight/2) > 30);
  });
  expect(target).toBeTruthy();
  // Sample on the same clock as the animation, starting at the real DOM click.
  await canvas.evaluate((el: any) => {
    el.cameraSamples = [];
    el.addEventListener('click', () => {
      const began = performance.now();
      const sample = () => {
        const c = el.sigma.getCamera(); el.cameraSamples.push([c.x, c.y]);
        if (performance.now() - began < 650) requestAnimationFrame(sample);
        else el.samplesComplete = true;
      };
      sample();
    }, { once: true, capture: true });
  });
  await page.mouse.click(rect.x + target.x, rect.y + target.y);
  await expect.poll(() => canvas.evaluate((el: any) => !!el.samplesComplete)).toBe(true);
  const samples = await canvas.evaluate((el: any) => el.cameraSamples);
  expect(new Set(samples.map(([x,y]: number[]) => `${x.toFixed(4)},${y.toFixed(4)}`)).size).toBeGreaterThan(2);
});

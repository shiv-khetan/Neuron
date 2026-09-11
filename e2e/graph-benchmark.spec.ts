import { test, expect } from './fixtures';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Opt-in benchmark: npm run bench:graph:browser. Uses the existing Electron fixture.
test.skip(process.env.GRAPH_BENCHMARK !== '1', 'Opt-in performance measurement');
test('measure Sigma at 100, 1000, 5000 and 10000 nodes', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('http://localhost:5174/graph-benchmark.html');
  await page.getByRole('button', { name: 'Run 100' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-complete', 'true', { timeout: 100_000 });
  const report = await page.locator('#results').textContent();
  writeFileSync(resolve('graph-browser-results.json'), report!);
  await page.screenshot({ path: 'graph-benchmark.png' });
});

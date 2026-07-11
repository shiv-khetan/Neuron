// Copy the bundled htmx runtime next to the compiled main process so packaged
// builds (which don't ship node_modules) can serve it to HTMX views offline.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = createRequire(import.meta.url).resolve('htmx.org/dist/htmx.min.js');
const dest = join(root, 'dist', 'main', 'htmx', 'htmx.min.js');
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`copied htmx.min.js -> ${dest}`);

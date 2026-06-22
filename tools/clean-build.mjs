import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = ['dist', 'release'];

for (const target of targets) {
  const absolute = path.join(root, target);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to clean outside the project: ${absolute}`);
  }
  fs.rmSync(absolute, { recursive: true, force: true });
  console.log(`[clean] removed ${target}/`);
}

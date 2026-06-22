import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const envName = args[0];
const publish = args.includes('--publish');
const dir = args.includes('--dir');
const store = args.includes('--store');

if (!['test', 'prod'].includes(envName)) {
  console.error('Usage: node tools/package-env.mjs <test|prod> [--publish]');
  process.exit(1);
}

function bin(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function run(command, args, env = {}, shell = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      shell,
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
  });
}

const npmCli = process.env.npm_execpath;
if (npmCli) {
  await run(process.execPath, [npmCli, 'run', 'build']);
} else {
  await run(bin('npm'), ['run', 'build'], {}, process.platform === 'win32');
}

const builder = path.join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
const builderArgs = ['--config', 'tools/electron-builder.env.cjs'];
if (dir) builderArgs.push('--dir');
else if (store) builderArgs.push('--win', 'appx');
else if (envName === 'test') builderArgs.push('--win', 'nsis');
if (publish) builderArgs.push('--win', 'nsis', '--publish', 'always');

await run(process.execPath, [builder, ...builderArgs], {
  NEURON_BUILD_ENV: envName,
  ...(envName === 'test' ? { CSC_IDENTITY_AUTO_DISCOVERY: 'false' } : {}),
});

import { spawn } from 'node:child_process';
const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(command, ['run', 'test:e2e', '--', 'e2e/graph-benchmark.spec.ts'], { env: { ...process.env, GRAPH_BENCHMARK: '1' }, stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true });
child.on('exit', code => { process.exitCode = code ?? 1; });

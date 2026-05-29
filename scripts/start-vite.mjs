import { spawn } from 'node:child_process';
import { PORTS } from './build.config.js';

const modeArg = process.argv[2] || 'development';
const mode = modeArg === 'test' ? 'test' : 'development';
const port = mode === 'test' ? PORTS.TEST : PORTS.PROD;

const child = spawn('pnpm', [
  'vite',
  '--port',
  String(port),
  '--mode',
  mode,
  '--logLevel',
  'error',
], {
  cwd: 'frontend',
  stdio: 'inherit',
  shell: false,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  }
  process.exit(code ?? 0);
});

import { spawn } from 'node:child_process';
import { PORTS, resolveAppMode } from './build.config.js';

const modeArg = process.argv[2] || 'development';
const mode = modeArg === 'test' ? 'test' : 'development';
const port = mode === 'test' ? PORTS.TEST : PORTS.PROD;

// Make the launched mode unmistakable so a human never collects release evidence from the
// wrong (mocked) environment. Single source of truth: APP_MODES in build.config.js.
const appMode = resolveAppMode(mode);
const line = '━'.repeat(48);
console.log(
  appMode.releaseProofEligible
    ? `\n${line}\n✅ MANUAL RELEASE TESTING MODE — real auth required.\n   URL: http://localhost:${appMode.port}\n   This run IS valid for manual STT release proof.\n${line}\n`
    : `\n${line}\n⚠️  MOCKED E2E DIAGNOSTICS ONLY — NOT valid for manual release proof.\n   URL: http://localhost:${appMode.port}\n${line}\n`,
);

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

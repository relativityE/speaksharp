#!/usr/bin/env node
import { spawn, spawnSync } from 'child_process';
import path from 'path';

const PORT = process.env.VITE_PORT || '5173';

console.log('[smoke] Running pre-flight checks...');
// Directly call the doctor script, as it's more robust than a package.json script
const doctor = spawnSync('pnpm', ['node', 'scripts/doctor.js'], { stdio: 'inherit' });

if (doctor.status !== 0) {
  console.error('❌ Smoke test aborted due to doctor check failure.');
  process.exit(doctor.status);
}

console.log('[smoke] ✅ Pre-flight checks passed.');
console.log('[smoke] Starting dev server...');

// Use a variable to hold the server process
let server;
let test;

// Graceful shutdown handler
const cleanup = (exitCode) => {
  console.log('[smoke] Cleaning up...');
  if (server) {
    console.log('[smoke] Killing dev server...');
    server.kill('SIGINT');
  }
  process.exit(exitCode);
};

// Handle exit signals
process.on('SIGINT', () => cleanup(1));
process.on('SIGTERM', () => cleanup(1));
process.on('exit', (code) => console.log(`[smoke] Exiting with code ${code}`));


server = spawn('pnpm', ['dev:test', '--', '--port', PORT], {
  stdio: 'inherit',
  shell: true,
  detached: false // Run in the same process group
});

server.on('error', (err) => {
    console.error('❌ Failed to start server process.', err);
    cleanup(1);
});

// A simple way to wait for the server. In a real-world scenario,
// you'd poll the URL or wait for a specific log output.
// For this turn-key script, a simple timeout is a reasonable start.
setTimeout(() => {
  console.log('[smoke] Assuming server is ready. Running smoke E2E test...');

  test = spawn('pnpm', ['exec', 'playwright', 'test', 'tests/e2e/basic.e2e.spec.ts'], {
    stdio: 'inherit',
    shell: true,
  });

  test.on('exit', (code) => {
    console.log(`[smoke] Test process exited with code ${code}.`);
    cleanup(code);
  });

  test.on('error', (err) => {
    console.error('❌ Failed to start test process.', err);
    cleanup(1);
  });

}, 5000); // 5-second delay to let the server start
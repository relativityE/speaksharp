import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const PID_FILE = path.join(process.cwd(), '.vite.pid');
let viteProcess: ChildProcess | null = null;

async function waitForVite() {
  const maxAttempts = 30;
  const delay = 1000;

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch('http://localhost:5173', { method: 'GET', timeout: 1000 });
      const text = await res.text();
      if (res.ok && text.includes('<title>SpeakSharp</title>')) {
        console.log('[global-setup] Health check passed. Vite is fully ready.');
        return;
      }
    } catch (err) {
      // still starting, ignore
    }
    console.log(`[global-setup] Waiting for Vite to be ready... (${i + 1}/${maxAttempts})`);
    await new Promise(r => setTimeout(r, delay));
  }

  // Safety Guard: If Vite never becomes ready, kill the process and throw an error.
  console.error('[global-setup] Vite did not become ready in time. Tearing down...');
  if (viteProcess && viteProcess.pid) {
    // Kill the entire process group
    try {
        process.kill(-viteProcess.pid, 'SIGKILL');
    } catch (e) {
        console.error('[global-setup] Failed to kill Vite process group.', e);
    }
  }
  throw new Error('Vite did not become ready in time.');
}

export default async function globalSetup() {
  console.log('[global-setup] Starting Vite...');

  viteProcess = spawn('pnpm', ['run', 'dev:test'], {
    stdio: 'pipe',
    detached: true // This is the key to creating a new process group
  });

  if (!viteProcess || !viteProcess.pid) {
    throw new Error('Vite process failed to start.');
  }

  fs.writeFileSync(PID_FILE, String(viteProcess.pid));

  viteProcess.stdout?.on('data', (data) => process.stdout.write(`[vite] ${data}`));
  viteProcess.stderr?.on('data', (data) => process.stderr.write(`[vite:err] ${data}`));

  await waitForVite();
}

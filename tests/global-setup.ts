// tests/global-setup.ts
import { spawn } from 'child_process';
import fetch from 'node-fetch';
import fs from 'fs';
import net from 'net';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SERVER_URL = 'http://localhost:5173';
const PORT = 5173;
const TIMEOUT_MS = 30000;        // max wait for server to boot
const CHECK_INTERVAL = 1000;     // how often to check
const WATCHDOG_INTERVAL = 5000;  // reassure logs while waiting

// Helper: Check if port is free
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolvePort) => {
    const tester = net.createServer()
      .once('error', () => resolvePort(false))
      .once('listening', () => tester.close(() => resolvePort(true)))
      .listen(port);
  });
}

export default async function globalSetup() {
  console.log('[global-setup] Checking if port is available...');

  const available = await isPortAvailable(PORT);
  if (!available) {
    throw new Error(`[global-setup] Port ${PORT} is already in use. Aborting.`);
  }

  console.log('[global-setup] Starting Vite dev server...');
  const child = spawn('pnpm', ['run', 'dev:test'], {
    stdio: 'pipe',
    shell: true,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CI: 'true'
    }
  });

  // Print real-time logs
  child.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[server-err] ${d}`));

  // Save PID for teardown
  const pidFile = resolve(__dirname, 'dev-server.pid');
  fs.writeFileSync(pidFile, String(child.pid));

  // Watchdog
  const watchdog = setInterval(() => {
    console.log('[global-setup] Waiting for dev server to be ready...');
  }, WATCHDOG_INTERVAL);

  const start = Date.now();
  while (true) {
    if (Date.now() - start > TIMEOUT_MS) {
      clearInterval(watchdog);
      child.kill();
      throw new Error('[global-setup] Dev server failed to start within timeout');
    }

    try {
      const res = await fetch(SERVER_URL);
      if (res.ok) {
        clearInterval(watchdog);
        console.log('[global-setup] Dev server is up!');
        return;
      }
    } catch {
      // server not ready yet
    }

    await new Promise((r) => setTimeout(r, CHECK_INTERVAL));
  }
}

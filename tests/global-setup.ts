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
const TIMEOUT_MS = 30000;
const CHECK_INTERVAL = 1000;
const WATCHDOG_INTERVAL = 5000;

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.once('close', () => resolve(true)).close();
      })
      .listen(port);
  });
}

export default async function globalSetup() {
  console.log('[global-setup] Checking if port is available...');

  const available = await isPortAvailable(PORT);
  if (!available) {
    throw new Error(`[global-setup] Port ${PORT} is already in use. Aborting.`);
  }

  console.log('[global-setup] Starting dev server...');

  const child = spawn('pnpm', ['run', 'dev:test'], {
    stdio: 'pipe',
    shell: true,
  });

  child.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[server-err] ${d}`));

  const pidFile = resolve(__dirname, 'dev-server.pid');
  fs.writeFileSync(pidFile, String(child.pid));

  const watchdog = setInterval(() => {
    console.log('[global-setup] Still waiting for dev server...');
  }, WATCHDOG_INTERVAL);

  const startTime = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - startTime > TIMEOUT_MS) {
      clearInterval(watchdog);
      throw new Error('[global-setup] Dev server failed to start within timeout');
    }
    try {
      const res = await fetch(SERVER_URL);
      if (res.ok) {
        console.log('[global-setup] Dev server is up!');
        clearInterval(watchdog);
        return;
      }
    } catch {
      // server not up yet, try again
    }
    await new Promise((r) => setTimeout(r, CHECK_INTERVAL));
  }
}

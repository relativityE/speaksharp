import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import net from 'net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 5173;          // dev server port
const TIMEOUT_MS = 30000;   // max wait for server
const CHECK_INTERVAL = 500; // ms

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.once('close', () => resolve(true)).close())
      .listen(port);
  });
}

export default async function globalSetup() {
  const pidFile = resolve(__dirname, 'dev-server.pid');

  // Clean up old PID if present
  if (fs.existsSync(pidFile)) {
    const oldPid = Number(fs.readFileSync(pidFile, 'utf-8'));
    try {
      process.kill(oldPid, 0); // check if alive
      console.warn(`[global-setup] ⚠️ Killing existing process PID ${oldPid}`);
      process.kill(oldPid, 'SIGKILL');
    } catch {
      console.log('[global-setup] Stale PID file found. Removing.');
    }
    fs.unlinkSync(pidFile);
  }

  console.log('[global-setup] Starting dev server...');
  const devServer = spawn('pnpm', ['run', 'dev:test'], {
    stdio: 'inherit',
    shell: true,
    detached: true,
  });

  fs.writeFileSync(pidFile, String(devServer.pid));
  console.log(`[global-setup] Dev server started with PID ${devServer.pid}`);

  // Wait for port to open
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    if (await isPortOpen(PORT)) {
      console.log('[global-setup] Dev server is ready!');
      return;
    }
    await new Promise((r) => setTimeout(r, CHECK_INTERVAL));
  }

  throw new Error(`[global-setup] Dev server did not start within ${TIMEOUT_MS / 1000}s`);
}

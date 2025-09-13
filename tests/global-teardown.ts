import fs from 'fs';
import { resolve } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default async function globalTeardown() {
  const pidFile = resolve(__dirname, 'dev-server.pid');

  if (!fs.existsSync(pidFile)) {
    console.log('[global-teardown] No PID file found. Nothing to kill.');
    return;
  }

  const pid = parseInt(fs.readFileSync(pidFile, 'utf-8'), 10);

  if (!pid) {
    console.log('[global-teardown] PID file empty or invalid.');
    return;
  }

  console.log(`[global-teardown] Killing dev server with PID ${pid}...`);

  try {
    // cross-platform kill using spawn
    if (process.platform === 'win32') {
      // Windows: taskkill
      spawn('taskkill', ['/PID', String(pid), '/F']);
    } else {
      // Unix-like: kill
      process.kill(pid, 'SIGTERM');
    }

    // Wait a short time for process to exit
    await new Promise((r) => setTimeout(r, 2000));

    if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);

    console.log('[global-teardown] Dev server terminated and PID file removed.');
  } catch (err) {
    console.error('[global-teardown] Failed to terminate dev server:', err);
  }
}

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const PID_FILE = path.join(process.cwd(), '.vite.pid');
const VITE_LOG = path.join(process.cwd(), 'vite.log');
const MAX_WAIT = 120; // seconds
const POLL_INTERVAL = 1000; // ms

let vitePort = 5173; // default fallback

/**
 * Wait until Vite server responds with HTTP 200
 */
async function waitForVite(url: string) {
  for (let i = 0; i < MAX_WAIT; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        console.log(`[global-setup] Vite responded with 200 OK at ${url}`);
        return;
      }
    } catch {
      // ignore errors while server is starting
    }
    console.log(`[global-setup] Waiting for Vite at ${url}... (${i + 1}/${MAX_WAIT})`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  throw new Error(`Vite did not become ready at ${url} in time.`);
}

/**
 * Parse Vite stdout for actual port
 */
function detectPortFromStdout(line: string) {
  const match = line.match(/Local:\s+http:\/\/localhost:(\d+)/);
  if (match) {
    vitePort = parseInt(match[1], 10);
    console.log(`[global-setup] Vite URL detected: http://localhost:${vitePort}/`);
  }
}

export default async function globalSetup() {
  console.log('[global-setup] Starting Vite server...');

  // Spawn Vite in detached mode
  const vite: ChildProcessWithoutNullStreams = spawn(
    'pnpm',
    ['vite', '--mode', 'test', '--host', '--port', '5173'],
    { shell: true, detached: true }
  );

  if (!vite.pid) throw new Error('Failed to start Vite server.');
  fs.writeFileSync(PID_FILE, String(vite.pid));
  console.log(`[global-setup] Vite PID: ${vite.pid}, logs at ${VITE_LOG}`);

  // Pipe stdout/stderr to vite.log and detect actual port
  const logStream = fs.createWriteStream(VITE_LOG, { flags: 'a' });
  vite.stdout.pipe(logStream);
  vite.stderr.pipe(logStream);

  vite.stdout.on('data', (chunk) => detectPortFromStdout(chunk.toString()));

  // Wait until Vite responds on the detected port
  const viteUrl = `http://localhost:${vitePort}/`;
  await waitForVite(viteUrl);

  console.log('[global-setup] Vite server ready. Playwright can now run tests.');
}

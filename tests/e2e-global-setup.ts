import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import * as dotenv from 'dotenv';

// Load environment variables from .env.test
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

const PID_FILE = path.join(process.cwd(), '.vite.pid');
const VITE_LOG = path.join(process.cwd(), 'vite.log');
const MAX_WAIT_SECONDS = 120;
const POLL_INTERVAL_MS = 1000;

/**
 * Waits for the Vite server to be ready and listening on a specific port.
 */
async function waitForVite(url: string): Promise<void> {
  for (let i = 0; i < MAX_WAIT_SECONDS; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        console.log(`[global-setup] Vite responded with 200 OK at ${url}`);
        return;
      }
    } catch {
      // Ignore fetch errors while the server is starting.
    }
    console.log(`[global-setup] Waiting for Vite at ${url}... (${i + 1}/${MAX_WAIT_SECONDS})`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Vite server did not become ready at ${url} within ${MAX_WAIT_SECONDS} seconds.`);
}

/**
 * Starts the Vite server and waits until it is responsive.
 * Detects the port from stdout and only writes the PID file after the server is healthy.
 */
export default async function globalSetup(): Promise<void> {
  console.log('[global-setup] Starting Vite server...');

  // Clear previous log file
  if (fs.existsSync(VITE_LOG)) {
    fs.unlinkSync(VITE_LOG);
  }

  const logStream = fs.createWriteStream(VITE_LOG, { flags: 'a' });
  const viteProcess: ChildProcessWithoutNullStreams = spawn(
    'pnpm',
    ['vite', '--mode', 'test', '--host', '--clearScreen', 'false'],
    { detached: true, shell: true }
  );

  viteProcess.stdout.pipe(logStream);
  viteProcess.stderr.pipe(logStream);

  const port = await new Promise<number>((resolve, reject) => {
    viteProcess.stdout.on('data', (data: Buffer) => {
      const line = data.toString();
      const match = line.match(/Local:\s+http:\/\/localhost:(\d+)/);
      if (match) {
        const detectedPort = parseInt(match[1], 10);
        console.log(`[global-setup] Vite server started on port: ${detectedPort}`);
        resolve(detectedPort);
      }
    });

    viteProcess.on('error', (err) => {
      reject(new Error(`Failed to start Vite server: ${err.message}`));
    });

    viteProcess.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Vite server exited with code ${code}. Check vite.log for details.`));
      }
    });
  });

  const viteUrl = `http://localhost:${port}/`;
  await waitForVite(viteUrl);

  // Only write the PID file *after* the server is confirmed to be ready.
  // This makes the teardown process much safer.
  if (!viteProcess.pid) {
    throw new Error('Vite server process has no PID.');
  }
  fs.writeFileSync(PID_FILE, String(viteProcess.pid));
  console.log(`[global-setup] Vite server ready. PID ${viteProcess.pid} written to ${PID_FILE}`);
}

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import http from 'http';

const PID_FILE = path.join(process.cwd(), '.vite.pid');

function loadEnvVars() {
  const envFile = path.resolve('.env.test');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/"/g, '');
  }
  console.log('[global-setup] Loaded .env.test');
}

async function waitForViteReady() {
  for (let i = 0; i < 30; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get('http://localhost:5173', { timeout: 1000 }, res => {
          if (res.statusCode === 200) resolve();
          else reject(new Error('Bad status: ' + res.statusCode));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      });
      console.log('[global-setup] Vite is ready.');
      return;
    } catch {
      console.log(`[global-setup] Waiting for Vite...`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw new Error('Vite never became ready');
}

export default async function globalSetup() {
  loadEnvVars();

  console.log('[global-setup] Starting Vite...');
  const vite = spawn('pnpm', ['run', 'dev:test'], {
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  });

  vite.stdout.on('data', d => process.stdout.write('[vite] ' + d));
  vite.stderr.on('data', d => process.stderr.write('[vite:err] ' + d));

  if (!vite.pid) throw new Error('Vite failed to start');
  fs.writeFileSync(PID_FILE, String(vite.pid));

  await waitForViteReady();
}

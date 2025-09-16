import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import http from 'http';

const PID_FILE = path.join(process.cwd(), '.vite.pid');
const ENV_FILE = path.join(process.cwd(), '.env.test');

// Function to load environment variables from a file into process.env
function loadEnvVars() {
  if (!fs.existsSync(ENV_FILE)) {
    console.warn(`.env.test file not found at ${ENV_FILE}`);
    return;
  }
  const envFileContent = fs.readFileSync(ENV_FILE, 'utf-8');
  envFileContent.split('\n').forEach(line => {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const [key, ...valueParts] = trimmedLine.split('=');
      const value = valueParts.join('=').replace(/"/g, ''); // Simple parsing
      if (key && value) {
        process.env[key] = value;
      }
    }
  });
  console.log('Successfully loaded environment variables from .env.test');
}

// Wait until server responds with HTML
async function waitForVite() {
  for (let i = 0; i < 30; i++) {
    try {
      await new Promise((resolve, reject) => {
        http.get('http://localhost:5173', (res) => {
          if (res.statusCode === 200) {
            console.log('[global-setup] Vite responded with 200 OK.');
            resolve(null);
          } else {
            reject(new Error(`Bad status: ${res.statusCode}`));
          }
        }).on('error', reject);
      });
      console.log('[global-setup] Vite is ready.');
      return;
    } catch (err) {
      console.log(`[global-setup] Waiting for Vite... attempt ${i + 1}/30`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw new Error('Vite never became ready');
}

async function globalSetup() {
  // Load environment variables before doing anything else
  loadEnvVars();

  console.log('Starting Vite server for E2E tests...');

  const serverProcess: ChildProcess = spawn('pnpm', ['vite', '--mode', 'test'], {
    stdio: 'inherit',
    detached: true,
    env: {
      ...process.env, // Pass the current environment variables to the child process
      NODE_ENV: 'test', // Explicitly set NODE_ENV to ensure test mode is recognized
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
    },
  });

  if (!serverProcess.pid) {
    throw new Error('Failed to start Vite server: No PID assigned.');
  }

  fs.writeFileSync(PID_FILE, String(serverProcess.pid));
  console.log(`Vite server started with PID: ${serverProcess.pid}. PID file created.`);

  // Wait for the server to be ready
  await waitForVite();

  // Unref the child process to allow the setup script to exit independently
  serverProcess.unref();
}

export default globalSetup;

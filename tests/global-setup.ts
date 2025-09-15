import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import fetch from 'node-fetch';

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
    },
  });

  if (!serverProcess.pid) {
    throw new Error('Failed to start Vite server: No PID assigned.');
  }

  fs.writeFileSync(PID_FILE, String(serverProcess.pid));
  console.log(`Vite server started with PID: ${serverProcess.pid}. PID file created.`);

  // Wait for the server to be ready
  const serverUrl = 'http://localhost:5173';
  const timeout = 60000; // 60 seconds
  const startTime = Date.now();
  let serverReady = false;

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(serverUrl);
      if (response.ok) {
        console.log('Vite server is ready.');
        serverReady = true;
        break;
      }
    } catch (err) {
      // Ignore errors, server is likely not up yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  if (!serverReady) {
    console.error('Vite server failed to start within the timeout period.');
    // Ensure the process is killed if the server never becomes ready
    if (serverProcess.pid) {
      try {
        process.kill(serverProcess.pid);
      } catch (e) {
        console.warn(`Could not kill process ${serverProcess.pid}. It may have already exited.`);
      }
    }
    throw new Error('Vite server failed to start.');
  }

  // Unref the child process to allow the setup script to exit independently
  serverProcess.unref();
}

export default globalSetup;

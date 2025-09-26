import { spawn } from 'child_process';

export default async function globalSetup() {
  console.log('[global-setup-simplified] Starting Vite server...');

  // Start the server in the background
  spawn('pnpm', ['dev'], {
    detached: true,
    stdio: 'ignore', // Ignore stdio to prevent any potential hanging
  });

  console.log('[global-setup-simplified] Waiting for 10 seconds for the server to initialize...');
  // Wait for a fixed time. This is less robust but avoids complex process monitoring.
  await new Promise(resolve => setTimeout(resolve, 10000));

  console.log('[global-setup-simplified] Setup complete.');
}
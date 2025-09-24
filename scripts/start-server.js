#!/usr/bin/env node
/**
 * start-server.js
 * Starts Vite in test mode and prints logs to stdout/stderr.
 * Fail fast if port is already in use or server doesn't start.
 */
import { spawn } from 'child_process';
import killPort from 'kill-port';

const PORT = process.env.VITE_PORT || '5173';

(async () => {
  try {
    // Free the port if something is already listening
    await killPort(PORT);
    console.log(`✅ Port ${PORT} cleared`);

    const server = spawn('pnpm', ['dev:test', '--', '--port', PORT], {
      stdio: 'inherit',
      shell: true,
    });

    server.on('exit', (code) => {
      if (code !== 0) {
        console.error(`❌ Server exited with code ${code}`);
        process.exit(code);
      }
    });

    process.on('SIGINT', () => {
      server.kill('SIGINT');
      process.exit(0);
    });
  } catch (err) {
    console.error('❌ Failed to start server', err);
    process.exit(1);
  }
})();
import * as fs from 'fs';
import * as path from 'path';

const PID_FILE = path.join(process.cwd(), '.vite.pid');

async function globalTeardown() {
  console.log('--- In global teardown ---');
  console.log('Tearing down Vite server...');

  try {
    if (!fs.existsSync(PID_FILE)) {
      console.log('PID file not found, server may have already stopped.');
      return;
    }

    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8'), 10);
    if (isNaN(pid)) {
      console.error('Invalid PID found in .vite.pid file.');
      return;
    }

    console.log(`Stopping server with PID group: ${pid}...`);
    // Use negative PID to kill the entire process group, as enabled by `detached: true`
    process.kill(-pid, 'SIGTERM');
    console.log('Sent SIGTERM to Vite process group. Waiting for shutdown...');

    // Wait up to 5 seconds for it to exit
    const waitMs = 5000;
    const start = Date.now();
    while (Date.now() - start < waitMs) {
      try {
        process.kill(-pid, 0); // check if still alive
        await new Promise((r) => setTimeout(r, 250));
      } catch {
        console.log('Vite process group exited cleanly.');
        return;
      }
    }

    console.warn('Vite process group did not exit after SIGTERM. Forcing SIGKILL...');
    try {
      process.kill(-pid, 'SIGKILL');
      console.log('Sent SIGKILL to Vite process group.');
    } catch (err: any) {
      if (err.code === 'ESRCH') {
        console.log('Process group already gone before SIGKILL.');
      } else {
        console.error('Error sending SIGKILL:', err);
      }
    }

  } catch (error: any) {
    if (error.code === 'ESRCH') {
      console.log(`Process group not found. It may have already been stopped.`);
    } else {
      console.error('Error during teardown:', error);
    }
  } finally {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
      console.log('Cleaned up PID file.');
    }
  }
}

export default globalTeardown;

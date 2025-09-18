import fs from 'fs';
import path from 'path';

const PID_FILE = path.join(process.cwd(), '.vite.pid');
const VITE_LOG = path.join(process.cwd(), 'vite.log');

export default async function globalTeardown() {
  console.log('[global-teardown] Starting Vite cleanup...');

  let pid: number | null = null;

  if (fs.existsSync(PID_FILE)) {
    pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8'), 10);
    if (isNaN(pid)) pid = null;
  }

  if (pid) {
    try {
      console.log(`[global-teardown] Sending SIGTERM to Vite (PID ${pid})`);
      process.kill(-pid, 'SIGTERM');

      // Wait up to 5 seconds for graceful shutdown
      const start = Date.now();
      while (Date.now() - start < 5000) {
        try {
          process.kill(pid, 0); // check if process is still alive
          await new Promise((r) => setTimeout(r, 250));
        } catch {
          console.log('[global-teardown] Vite exited cleanly.');
          break;
        }
      }

      // Force kill if still alive
      try {
        process.kill(-pid, 'SIGKILL');
        console.log('[global-teardown] Vite forcibly killed.');
      } catch {}
    } catch (err: any) {
      if (err.code === 'ESRCH') {
        console.log('[global-teardown] Process already stopped.');
      } else {
        console.error('[global-teardown] Error killing Vite:', err);
      }
    }
  } else {
    console.warn('[global-teardown] PID not found or invalid.');
  }

  // Print last 20 lines of vite.log if it exists
  if (fs.existsSync(VITE_LOG)) {
    console.log('--- Last 20 lines of vite.log (teardown) ---');
    const lines = fs.readFileSync(VITE_LOG, 'utf-8').split('\n');
    const lastLines = lines.slice(-20);
    lastLines.forEach((line) => console.log(line));
    console.log('--- End of vite.log ---');
  }

  // Cleanup PID file
  if (fs.existsSync(PID_FILE)) {
    fs.unlinkSync(PID_FILE);
    console.log('[global-teardown] PID file cleaned up.');
  }

  console.log('[global-teardown] Finished Vite cleanup.');
}

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const VITE_LOG = path.join(process.cwd(), 'vite.log');
const VITE_PORT = 5173; // The port our Vite server is configured to use

/**
 * Finds and kills the process listening on the specified port.
 * This is more robust than relying on a PID file.
 */
function killProcessByPort(port: number) {
  try {
    // Find the PID of the process using the port. The -t flag returns only the PID.
    const pid = execSync(`lsof -t -i :${port}`).toString().trim();

    if (pid) {
      console.log(`[global-teardown] Found process ${pid} on port ${port}. Terminating...`);
      // Kill the process. Using -9 (SIGKILL) for simplicity in this environment.
      execSync(`kill -9 ${pid}`);
      console.log(`[global-teardown] Process ${pid} terminated.`);
    } else {
      console.log(`[global-teardown] No process found on port ${port}.`);
    }
  } catch {
    // lsof throws an error if no process is found, so we can ignore it.
    console.log(`[global-teardown] No process found on port ${port} or an error occurred. Continuing cleanup.`);
  }
}

export default async function globalTeardown() {
  console.log('[global-teardown] Starting robust cleanup...');

  killProcessByPort(VITE_PORT);

  // Print last 20 lines of vite.log if it exists
  if (fs.existsSync(VITE_LOG)) {
    console.log('--- Last 20 lines of vite.log (teardown) ---');
    const lines = fs.readFileSync(VITE_LOG, 'utf-8').split('\n');
    const lastLines = lines.slice(-20);
    lastLines.forEach((line) => console.log(line));
    console.log('--- End of vite.log ---');
  }

  // Cleanup PID file just in case it was created
  const PID_FILE = path.join(process.cwd(), '.vite.pid');
  if (fs.existsSync(PID_FILE)) {
    fs.unlinkSync(PID_FILE);
    console.log('[global-teardown] PID file cleaned up.');
  }

  console.log('[global-teardown] Finished robust cleanup.');
}

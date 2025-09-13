import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default async function globalTeardown() {
  const pidFile = resolve(__dirname, 'dev-server.pid');

  if (!fs.existsSync(pidFile)) {
    console.log('[global-teardown] No PID file found, nothing to clean up.');
    return;
  }

  const pid = Number(fs.readFileSync(pidFile, 'utf-8'));
  console.log(`[global-teardown] Attempting to kill dev server with PID ${pid}...`);

  try {
    process.kill(pid, 'SIGTERM');
    console.log('[global-teardown] Sent SIGTERM. Waiting 3s for graceful shutdown...');

    await new Promise((res) => setTimeout(res, 3000));

    try {
      // Check if still alive
      process.kill(pid, 0);
      console.warn('[global-teardown] Process still alive. Sending SIGKILL...');
      process.kill(pid, 'SIGKILL');
      console.log('[global-teardown] ✅ Dev server force killed');
    } catch {
      console.log('[global-teardown] ✅ Dev server terminated gracefully');
    }
  } catch (err) {
    console.warn(`[global-teardown] ⚠️ Failed to kill process ${pid}:`, err);
  }

  fs.unlinkSync(pidFile);
}

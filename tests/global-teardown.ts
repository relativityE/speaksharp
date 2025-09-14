// tests/global-teardown.ts
import fs from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pidFile = resolve(__dirname, 'dev-server.pid');

export default async function globalTeardown() {
  if (fs.existsSync(pidFile)) {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8'), 10);
    try {
      process.kill(pid);
      console.log('[global-teardown] Dev server stopped');
    } catch (err) {
      console.warn('[global-teardown] Failed to stop dev server:', err);
    }
    fs.unlinkSync(pidFile);
  } else {
    console.log('[global-teardown] No PID file found, skipping');
  }
}

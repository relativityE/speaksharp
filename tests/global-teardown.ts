import * as fs from 'fs';
import * as path from 'path';

const PID_FILE = path.join(process.cwd(), '.vite.pid');

async function globalTeardown() {
  console.log('--- In global teardown ---');

  // Try to read the screenshot file and log it as base64
  const screenshotPath = path.join(
    process.cwd(),
    'test-results',
    'anon.e2e-Anonymous-User-Flow-start-temporary-session-chromium',
    'test-failed-1.png'
  );

  try {
    if (fs.existsSync(screenshotPath)) {
      console.log(`Attempting to read screenshot from: ${screenshotPath}`);
      const screenshotContent = fs.readFileSync(screenshotPath, { encoding: 'base64' });
      console.log('--- SCREENSHOT_BASE64_START ---');
      console.log(screenshotContent);
      console.log('--- SCREENSHOT_BASE64_END ---');
    } else {
      console.warn(`Screenshot not found at path: ${screenshotPath}`);
    }
  } catch (e: any) {
    console.warn('Could not read screenshot file:', e.message);
  }

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

    console.log(`Stopping server with PID: ${pid}...`);
    process.kill(pid, 'SIGTERM');
    console.log('Sent SIGTERM to Vite server.');

  } catch (error: any) {
    if (error.code === 'ESRCH') {
      console.log(`Process with PID ${error.pid} not found. It may have already been stopped.`);
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

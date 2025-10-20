// tests/global-setup.ts
import type { FullConfig } from '@playwright/test';
import fetch from 'node-fetch';

const port = process.env.PORT || '5173';
const baseURL = `http://localhost:${port}`;

async function globalSetup(config: FullConfig) {
  let retries = 5;
  const retryDelay = 3000; // 3 seconds

  console.log(`[GlobalSetup] Starting health check for ${baseURL}...`);

  while (retries > 0) {
    try {
      const response = await fetch(baseURL, { timeout: 5000 });
      if (response.ok) {
        console.log(`[GlobalSetup] Health check PASSED. Application is running at ${baseURL}.`);
        return; // Success
      }
      throw new Error(`Health check failed with status: ${response.status}`);
    } catch (error) {
      console.warn(`[GlobalSetup] Health check failed. Retrying in ${retryDelay / 1000} seconds... (${retries} retries left)`);
      retries--;
      if (retries > 0) {
        await new Promise(res => setTimeout(res, retryDelay));
      } else {
        throw new Error(`[GlobalSetup] FATAL: Application at ${baseURL} did not become ready in time after multiple retries.`);
      }
    }
  }
}

export default globalSetup;

import { chromium, FullConfig } from '@playwright/test';
import { worker } from '../src/mocks/browser';

async function globalSetup(config: FullConfig) {
  // Start the MSW worker
  await worker.start();
  console.log('MSW worker started globally');
}

export default globalSetup;
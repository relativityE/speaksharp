
const dotenv = require('dotenv');
import path from 'path';

export async function setup(): Promise<void> {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });
  console.log('Global setup: .env.test loaded.');
}

export async function teardown(): Promise<void> {
  // Clean up if necessary
}

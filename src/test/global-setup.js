/* globals process */
import dotenv from 'dotenv';
import path from 'path';

export async function setup() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });
  console.log('Global setup: .env.test loaded.');
}

export async function teardown() {
  // Clean up if necessary
}

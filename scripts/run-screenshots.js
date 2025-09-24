#!/usr/bin/env node
/**
 * run-screenshots.js
 * Run any E2E screenshot test file safely.
 */
import { spawnSync } from 'child_process';
import path from 'path';

const args = process.argv.slice(2);
if (!args.length) {
  console.error('❌ No test file specified. Usage: run-screenshots.js <test-file>');
  process.exit(1);
}

const testFile = args[0];

// Step 1: doctor check
console.log('🔍 Running pre-flight doctor...');
const doctor = spawnSync('pnpm', ['node', 'scripts/doctor.js'], { stdio: 'inherit' });
if (doctor.status !== 0) process.exit(doctor.status);

// Step 2: run Playwright test
console.log(`🧪 Running Playwright test: ${testFile}`);
const result = spawnSync('pnpm', ['exec', 'playwright', 'test', testFile, '--update-snapshots'], { stdio: 'inherit' });

process.exit(result.status);
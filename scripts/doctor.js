#!/usr/bin/env node
/**
 * doctor.js
 * Pre-flight checks: node_modules, .env.test, VITE_PORT, Playwright browsers.
 */
import fs from 'fs';
import { execSync } from 'child_process';

const files = ['.env.test', 'package.json', 'node_modules'];
let ok = true;

// Check files exist
files.forEach(f => {
  if (!fs.existsSync(f)) {
    console.error(`❌ Missing required file or directory: ${f}`);
    ok = false;
  }
});

// Check VITE_PORT defined
const envTest = fs.readFileSync('.env.test', 'utf-8');
if (!/VITE_PORT/.test(envTest)) {
  console.error('❌ VITE_PORT not defined in .env.test');
  ok = false;
}

// Check Playwright browsers installed
try {
  execSync('pnpm exec playwright install --with-deps', { stdio: 'inherit' });
} catch {
  console.error('❌ Playwright browser install failed');
  ok = false;
}

if (!ok) process.exit(1);
console.log('✅ Doctor check passed');
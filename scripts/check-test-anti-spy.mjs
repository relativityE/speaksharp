#!/usr/bin/env node

/**
 * Anti-Spy Linting Script
 * 
 * PURPOSE:
 * Detects legacy test patterns that spy on internal implementations 
 * rather than asserting on public state/behavior.
 */

import fs from 'fs';
import path from 'path';
import { globSync } from 'glob';

const TEST_DIR = 'frontend/src/**/*.test.{ts,tsx}';
const FORBIDDEN_PATTERNS = [
    /vi\.mock\(['"].*modes\/NativeBrowser['"]/i,
    /vi\.mock\(['"].*modes\/PrivateWhisper['"]/i,
    /vi\.spyOn\(.*['"]instance['"]\)/i,
    /window\.__E2E_MOCK_/i
];

console.log(`\n🔍 Scanning tests for implementation-specific spying: ${TEST_DIR}`);

const files = globSync(TEST_DIR);
let violationCount = 0;

files.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    FORBIDDEN_PATTERNS.forEach(pattern => {
        if (pattern.test(content)) {
            console.warn(`⚠️  VIOLATION: ${file} matches pattern ${pattern}`);
            violationCount++;
        }
    });
});

if (violationCount > 0) {
    console.log(`\n❌ Found ${violationCount} architectural violations in tests.`);
    process.exit(0); // Warning only for now to not break CI immediately
} else {
    console.log('\n✅ No implementation-specific spying detected.');
}

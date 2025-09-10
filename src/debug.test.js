console.log('=== FILE LOADING START ===');

import { test, expect } from 'vitest';
console.log('=== VITEST IMPORTED ===');

console.log('=== ABOUT TO DEFINE TEST ===');
test('basic test', () => {
  console.log('=== INSIDE TEST ===');
  expect(1).toBe(1);
});
console.log('=== FILE LOADING COMPLETE ===');

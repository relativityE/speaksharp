#!/usr/bin/env node
// #1260 — fail closed if tracked text or a tracked path reintroduces the unaffiliated domain.
// The forbidden value is assembled from fragments so the scanner and its contract can scan themselves.

import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';

const BRAND = 'speak' + 'sharp';
const TLD = 'a' + 'i';
const DOT = '(?:\\\\?\\.|%2e'
  + '|&#0*46;?'
  + '|&#x0*2e;?'
  + '|&period;?'
  + '|\\\\u002e'
  + '|\\\\u\\{0*2e\\}'
  + '|\\\\x2e'
  + ')';

export const FORBIDDEN = new RegExp(BRAND + DOT + TLD, 'i');
export const FORBIDDEN_GLOBAL = new RegExp(BRAND + DOT + TLD, 'ig');

export function scanText(text) {
  const matches = text.match(FORBIDDEN_GLOBAL);
  return matches ? [...matches] : [];
}

const BINARY_EXTENSIONS = new Set([
  'avif', 'bin', 'br', 'eot', 'flac', 'gif', 'gz', 'ico', 'jpeg', 'jpg', 'm4a', 'mp3', 'mp4',
  'node', 'ogg', 'onnx', 'pdf', 'png', 'tgz', 'ttf', 'wasm', 'wav', 'webm', 'webp', 'woff',
  'woff2', 'zip',
]);

function looksBinary(buffer) {
  const length = Math.min(buffer.length, 8000);
  for (let index = 0; index < length; index += 1) {
    if (buffer[index] === 0) return true;
  }
  return false;
}

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'buffer' })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

function main() {
  const offenders = [];

  for (const file of trackedFiles()) {
    if (FORBIDDEN.test(file)) offenders.push(`${file} (path)`);

    let text;
    try {
      if (lstatSync(file).isSymbolicLink()) {
        text = readlinkSync(file);
      } else {
        const extension = (file.split('.').pop() || '').toLowerCase();
        if (BINARY_EXTENSIONS.has(extension)) continue;
        const buffer = readFileSync(file);
        if (looksBinary(buffer)) continue;
        text = buffer.toString('utf8');
      }
    } catch {
      continue;
    }

    if (!FORBIDDEN.test(text)) continue;
    text.split('\n').forEach((line, index) => {
      if (FORBIDDEN.test(line)) offenders.push(`${file}:${index + 1}`);
    });
  }

  if (offenders.length > 0) {
    console.error(`[no-unaffiliated-domain] FAIL — ${offenders.length} tracked reference(s) found:`);
    for (const offender of offenders) console.error(`  - ${offender}`);
    process.exit(1);
  }

  console.log('[no-unaffiliated-domain] OK — zero tracked references.');
}

if (process.argv[1]?.endsWith('no-unaffiliated-domain-scan.mjs')) main();

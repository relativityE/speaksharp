#!/usr/bin/env node
// Apply a mutation to a file, FAILING LOUDLY if the anchor is not present exactly once.
//
// WHY THIS EXISTS. A mutation whose anchor never matches is a SILENT NO-OP: nothing changes, the
// suite passes, and the run reads as "the check holds" when in fact the check was never exercised.
// That has now happened three times in this project — most recently because a target expression
// spanned two lines and a single-line anchor could never match it.
//
// Remembering to verify the anchor is a discipline, and disciplines are forgotten. This is a tool.
//
//   node scripts/mutate-check.mjs <file> <anchor-file> <replacement-file>
//   node scripts/mutate-check.mjs --restore <file> <backup>
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';

const [, , ...argv] = process.argv;
if (argv[0] === '--restore') {
    const [, file, backup] = argv;
    copyFileSync(backup, file);
    console.log(`restored ${file}`);
    process.exit(0);
}

const [file, anchorFile, replacementFile] = argv;
if (!file || !anchorFile || !replacementFile) {
    console.error('usage: mutate-check.mjs <file> <anchor-file> <replacement-file>');
    process.exit(2);
}

const source = readFileSync(file, 'utf8');
const anchor = readFileSync(anchorFile, 'utf8').replace(/\n$/, '');
const replacement = readFileSync(replacementFile, 'utf8').replace(/\n$/, '');

const occurrences = source.split(anchor).length - 1;
if (occurrences === 0) {
    console.error(`::MUTATION-NO-OP:: anchor NOT FOUND in ${file}. The mutation would change nothing,`);
    console.error('  and the suite would pass while proving nothing. Fix the anchor.');
    console.error(`  anchor was:\n${anchor}`);
    process.exit(1);
}
if (occurrences > 1) {
    console.error(`::MUTATION-AMBIGUOUS:: anchor matched ${occurrences} times in ${file}; expected exactly 1.`);
    process.exit(1);
}

writeFileSync(file, source.replace(anchor, replacement));
console.log(`mutation APPLIED to ${file} (anchor matched exactly once)`);

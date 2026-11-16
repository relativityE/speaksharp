#!/usr/bin/env node
'use strict';
// Nightly AHT suite: behavioural negative controls. For every seeded break in breaks.json:
//   1. the `find` text must occur exactly once in `file` (else the control is stale and the run fails);
//   2. apply the break and run its node:test file: it must FAIL;
//   3. restore the file byte for byte (always, even on error) and run the test again: it must PASS.
// Usage: node tools/cloud-test/nightly/negative-controls/run.cjs [--only <id>] [--out <results.json>]
// Offline only: paths in breaks.json are relative to tools/cloud-test/nightly, and nothing outside it is touched.
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const only = opt('--only');
const out = opt('--out');
const spec = JSON.parse(readFileSync(path.join(__dirname, 'breaks.json'), 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const inside = (rel) => {
    const full = path.resolve(root, rel);
    if (!full.startsWith(root + path.sep)) throw new Error(`${rel} is outside the nightly folder`);
    return full;
};

function runTest(test) {
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=dot', inside(test)], { cwd: root, encoding: 'utf8', timeout: 120000 });
    return r.status === 0 ? 'PASS' : 'FAIL';
}

const results = [];
let ok = true;
for (const b of spec.breaks.filter((x) => !only || x.id === only)) {
    const file = inside(b.file);
    const original = readFileSync(file);
    const text = original.toString('utf8');
    const count = text.split(b.find).length - 1;
    const row = { id: b.id, guards: b.guards, test: b.test, fileSha256: sha(original) };
    if (count !== 1) {
        Object.assign(row, { verdict: 'STALE', detail: `find text occurs ${count} times` });
        ok = false; results.push(row); console.log(`${b.id}: STALE (${count} matches)`); continue;
    }
    let broken;
    try {
        writeFileSync(file, text.replace(b.find, () => b.replace));
        broken = runTest(b.test);
    } finally {
        writeFileSync(file, original);
    }
    if (sha(readFileSync(file)) !== row.fileSha256) throw new Error(`${b.file} was not restored byte for byte`);
    const restored = runTest(b.test);
    const verdict = broken === 'FAIL' && restored === 'PASS' ? 'PROVEN' : 'NOT PROVEN';
    if (verdict !== 'PROVEN') ok = false;
    Object.assign(row, { onBreak: broken, onRestore: restored, verdict });
    results.push(row);
    console.log(`${b.id}: break ${broken}, restored ${restored} -> ${verdict}`);
}
if (results.length === 0) { console.error('no negative control selected'); process.exit(2); }
const doc = { schema: 'speaksharp.aht-nightly.negative-control-results.v1', at: new Date().toISOString(), results };
if (out) writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
process.exit(ok ? 0 : 1);

#!/usr/bin/env node
/**
 * Read-only consistency check of supplied evidence; not live-fact collection,
 * registration or activation. Independently verified current facts must come
 * from the operator. The command owns validation time, never context.now.
 *
 * node scripts/account-closure-offline-preflight.mjs \
 *   --schema schema.json --attestation drain.json --context current.json
 */
import { constants, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { validateAccountClosureReleasePreflight } from './lib/accountClosureReleasePreflight.mjs';

const limit = 1024 * 1024;
const usage = 'Usage: account-closure-offline-preflight.mjs --schema FILE --attestation FILE --context FILE\n'
    + 'Offline supplied-evidence validation only; no collection or activation. Uses the current wall clock.\n';

function argumentsFor(args) {
    const allowed = new Set(['--schema', '--attestation', '--context']);
    const paths = new Map();
    if (args.length !== 6) throw new Error('arguments');
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i]; const value = args[i + 1];
        if (!allowed.has(key) || paths.has(key) || !value || value.startsWith('--')) throw new Error('arguments');
        paths.set(key, value);
    }
    return paths;
}

function readJson(path) {
    // NONBLOCK prevents a FIFO from hanging before the regular-file check.
    // NOFOLLOW rejects symlinks; neither input paths nor file content is echoed.
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > limit) throw new Error('input');
        const bytes = Buffer.alloc(limit + 1);
        let count = 0;
        while (count <= limit) {
            const next = readSync(fd, bytes, count, bytes.length - count, null);
            if (next === 0) break;
            count += next;
        }
        if (count > limit) throw new Error('input');
        return JSON.parse(bytes.subarray(0, count).toString('utf8'));
    } finally { closeSync(fd); }
}

function hold(reason, exitCode) {
    process.stderr.write(`${JSON.stringify({ status: 'HOLD', reason, activationAuthorized: false })}\n`);
    process.exitCode = exitCode;
}

function main(args) {
    if (args.length === 1 && args[0] === '--help') { process.stdout.write(usage); return; }
    let paths;
    try { paths = argumentsFor(args); } catch { hold('INVALID_ARGUMENTS', 2); return; }
    let schema; let attestation; let context;
    try {
        schema = readJson(paths.get('--schema'));
        attestation = readJson(paths.get('--attestation'));
        context = readJson(paths.get('--context'));
        if (!context || typeof context !== 'object' || Array.isArray(context)) throw new Error('input');
    } catch { hold('INVALID_INPUT', 2); return; }
    try {
        const checkedAt = new Date().toISOString();
        const result = validateAccountClosureReleasePreflight(schema, attestation, { ...context, now: checkedAt });
        // Input processing/validation must not leave an already-expired success.
        if (Date.parse(attestation.expiresAt) <= Date.now()) throw new Error('expired');
        process.stdout.write(`${JSON.stringify({ ...result, checkedAt })}\n`);
    } catch { hold('EVIDENCE_NOT_VALID', 3); }
}

main(process.argv.slice(2));

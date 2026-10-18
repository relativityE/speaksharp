#!/usr/bin/env node
/**
 * Acquire available read-only facts; never register a grant or activate deletion.
 * Credentials come only from the existing operator environment. The manifest
 * contains nonsecret target/deployment pins. The exclusive 0600 output contains
 * private opaque account/operation/session identifiers: keep it protected.
 * Exit 3 means HOLD even when partial acquisition completed successfully.
 *
 * node scripts/account-closure-current-facts.mjs --manifest target.json --output private-receipt.json
 */
import { constants, openSync, fstatSync, readSync, writeFileSync, fsyncSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAccountClosureCurrentFacts } from './lib/accountClosureCurrentFacts.mjs';

const usage = 'Usage: account-closure-current-facts.mjs --manifest FILE --output NEW_PRIVATE_FILE\n'
  + 'Read-only partial facts; no registration or activation. Exit 3 = HOLD.\n'
  + 'Environment: SUPABASE_ACCESS_TOKEN, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY.\n';
const closed = (v, keys) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v, key));
function argumentsFor(args) {
  const values = new Map();
  if (args.length !== 4) throw new Error('arguments');
  for (let i = 0; i < args.length; i += 2) {
    if (!['--manifest', '--output'].includes(args[i]) || values.has(args[i])
      || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('arguments');
    values.set(args[i], args[i + 1]);
  }
  return values;
}
function readManifest(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const size = 65536; const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > size) throw new Error('input');
    const buffer = Buffer.alloc(size + 1); let count = 0;
    while (count <= size) {
      const read = readSync(fd, buffer, count, buffer.length - count, null);
      if (!read) break;
      count += read;
    }
    if (count > size) throw new Error('input');
    const value = JSON.parse(buffer.subarray(0, count).toString('utf8'));
    if (!closed(value, ['url', 'projectId', 'environment', 'candidateSha', 'stripeAccountId', 'artifacts'])
      || !Array.isArray(value.artifacts) || value.artifacts.some((pin) =>
        !closed(pin, ['function', 'id', 'version', 'bundleDigest', 'candidateSha']))
      || typeof value.stripeAccountId !== 'string' || !/^acct_[a-zA-Z0-9]+$/.test(value.stripeAccountId)) throw new Error('input');
    return value;
  } finally { closeSync(fd); }
}

export async function runAccountClosureCurrentFactsCommand(args, dependencies = {}) {
  const stdout = dependencies.stdout ?? ((text) => process.stdout.write(text));
  const stderr = dependencies.stderr ?? ((text) => process.stderr.write(text));
  const fail = (reason) => {
    stderr(`${JSON.stringify({ status: 'HOLD', reason, activationAuthorized: false })}\n`);
    return 2;
  };
  if (args.length === 1 && args[0] === '--help') { stdout(usage); return 0; }
  let paths; let manifest; let collector;
  try { paths = argumentsFor(args); } catch { return fail('INVALID_ARGUMENTS'); }
  try { manifest = readManifest(paths.get('--manifest')); } catch { return fail('INVALID_MANIFEST'); }
  try {
    const env = dependencies.environment ?? process.env;
    const managementToken = env.SUPABASE_ACCESS_TOKEN; const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    const stripeKey = env.STRIPE_SECRET_KEY;
    if (![managementToken, serviceKey, stripeKey].every((value) => typeof value === 'string' && value.trim())
      || !new RegExp(`^(?:sk|rk)_${manifest.environment === 'production' ? 'live' : 'test'}_`).test(stripeKey)) throw new Error('configuration');
    collector = createAccountClosureCurrentFacts({ ...manifest, managementToken, serviceKey, stripeKey }, dependencies.fetcher ?? fetch);
  } catch { return fail('INVALID_CONFIGURATION'); }
  // Refuse an existing file, symlink or unusable output BEFORE any network read.
  let fd;
  try { fd = openSync(paths.get('--output'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch { return fail('OUTPUT_UNAVAILABLE'); }
  try {
    const result = await collector.readAvailableFacts();
    if (result?.status !== 'HOLD' || result.activationAuthorized !== false) throw new Error('unexpected result');
    const checkedAt = new Date().toISOString();
    const receipt = JSON.stringify({ version: 1, checkedAt, ...result });
    if (Buffer.byteLength(receipt) > 8 * 1024 * 1024) throw new Error('oversize output');
    writeFileSync(fd, `${receipt}\n`, 'utf8'); fsyncSync(fd);
    stdout(`${JSON.stringify({ status: 'HOLD', reason: result.reason, activationAuthorized: false,
      factsCaptured: !!result.facts, checkedAt })}\n`);
    return 3;
  } catch { return fail('RECEIPT_UNVERIFIED'); }
  finally { closeSync(fd); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runAccountClosureCurrentFactsCommand(process.argv.slice(2));
}

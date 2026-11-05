'use strict';

// One-off R10 first-use prerequisite proof.  This helper uses only the two
// selected users' own JWTs and the publishable key.  It never receives a
// service-role key, prints identifiers, or writes row contents.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROLES = Object.freeze(['existing-disposable', 'maintained-read-only']);
const PASSWORDS = Object.freeze({
  'existing-disposable': 'THROWAWAY_TEST_PASSWORD',
  'maintained-read-only': 'FREE_TEST_PASSWORD',
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA40 = /^[0-9a-f]{40}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._:@/#-]{2,159}$/;
const RUN_ID = 'R10-3b040043-smoke15';
const OCCURRENCE_WINDOW_MS = 80 * 60 * 1000;  // init_run_inputs.SMOKE_OCCURRENCE_WINDOW_MINUTES
const REQUEST_TIMEOUT_MS = 10000;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
// The one clock every deadline check reads; tests replace clock.now, production never does.
const clock = {now: () => Date.now()};

function refuse(code) { const error = new Error(code); error.code = 'BLOCKED_SETUP'; throw error; }
function plain(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (Number.isSafeInteger(value)) return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  refuse('non-canonical-value');
}
function bytes(value) { return Buffer.from(`${JSON.stringify(canonical(value))}\n`, 'utf8'); }
function writePrivate(file, value) {
  const parent = path.dirname(path.resolve(file));
  const stat = fs.lstatSync(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700) refuse('output-parent-not-private');
  const fd = fs.openSync(path.resolve(file), 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes(value)); } finally { fs.closeSync(fd); }
}
function readJson(file, code) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) refuse(code);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) { if (error.code === 'BLOCKED_SETUP') throw error; refuse(code); }
}
function bundleFromEnvironment() {
  let document;
  try { document = JSON.parse(process.env.CLOUD_TEST_LIVE_ACCOUNTS || ''); } catch { refuse('bundle-not-json'); }
  if (!plain(document) || document.version !== 1 || !/^[a-z0-9]{20}$/.test(document.projectRef || '')
      || !plain(document.accounts) || Object.keys(document.accounts).sort().join(',') !== [...ROLES].sort().join(',')) refuse('bundle-shape');
  for (const role of ROLES) {
    const account = document.accounts[role];
    if (!plain(account) || Object.keys(account).sort().join(',') !== 'accountId,email'
        || !UUID.test(account.accountId || '') || typeof account.email !== 'string' || account.email.length > 254
        || account.email.split('@').length !== 2) refuse('bundle-shape');
  }
  if (document.accounts[ROLES[0]].accountId === document.accounts[ROLES[1]].accountId) refuse('bundle-duplicate');
  return document;
}
function originFor(bundle) {
  let origin;
  try { origin = new URL(process.env.SUPABASE_URL || ''); } catch { refuse('project-origin'); }
  if (origin.origin !== `https://${bundle.projectRef}.supabase.co` || origin.pathname !== '/' || origin.search || origin.hash) refuse('project-origin');
  return origin.origin;
}
function authorizedOccurrence(file, expectedSha) {
  // The occurrence the run was authorized for: exactly the bytes record-begin selected (by digest), the one-off R10 run, its creation
  // equal to its window start, and the reviewed 80-minute window.
  let raw;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 262144) refuse('occurrence-unreadable');
    raw = fs.readFileSync(file);
  } catch (error) { if (error.code === 'BLOCKED_SETUP') throw error; refuse('occurrence-unreadable'); }
  if (!/^[0-9a-f]{64}$/.test(expectedSha || '') || sha(raw) !== expectedSha) refuse('occurrence-not-the-authorized-bytes');
  let occurrence;
  try { occurrence = JSON.parse(raw.toString('utf8')); } catch { refuse('occurrence-unreadable'); }
  const window = plain(occurrence) ? occurrence.window : null;
  if (!plain(window) || occurrence.runId !== RUN_ID || occurrence.createdUtc !== window.startUtc
      || !UTC.test(window.startUtc || '') || !UTC.test(window.endUtc || '')) refuse('occurrence-shape');
  const start = Date.parse(window.startUtc), end = Date.parse(window.endUtc);
  if (end - start !== OCCURRENCE_WINDOW_MS) refuse('occurrence-window');
  return {start, end};
}
function requireDeadline(deadline) {
  // Before the first request and before every later one: the authorized window must be open, and the whole bounded request (its
  // timeout) must finish before the deadline. Nothing is sent once it cannot.
  const now = clock.now();   // the lexical clock: tests replace clock.now on the same exported object
  if (!deadline || now < deadline.start || now + REQUEST_TIMEOUT_MS > deadline.end) refuse('occurrence-deadline');
}
async function request(url, options, code, deadline) {
  requireDeadline(deadline);
  let response;
  try { response = await fetch(url, {...options, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)}); }
  catch { refuse(`${code}-transport`); }
  let body;
  try { body = await response.json(); } catch { refuse(`${code}-response`); }
  return {status: response.status, body};
}
async function inspectRole(origin, anon, role, account, otherId, deadline) {
  const password = process.env[PASSWORDS[role]];
  if (typeof password !== 'string' || !password) refuse('role-password-missing');
  const auth = await request(`${origin}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: {apikey: anon, 'content-type': 'application/json'},
    body: JSON.stringify({email: account.email, password}),
  }, 'auth', deadline);
  if (auth.status !== 200 || !plain(auth.body) || typeof auth.body.access_token !== 'string'
      || !plain(auth.body.user) || auth.body.user.id !== account.accountId) refuse('auth-binding');
  const token = auth.body.access_token;
  const headers = {apikey: anon, authorization: `Bearer ${token}`, accept: 'application/json'};
  async function rows(table, id, select) {
    const query = new URL(`${origin}/rest/v1/${table}`);
    query.searchParams.set('select', select);
    query.searchParams.set(table === 'user_profiles' ? 'id' : 'user_id', `eq.${id}`);
    query.searchParams.set('limit', '2');
    const result = await request(query, {method: 'GET', headers}, 'rls-read', deadline);
    if (result.status !== 200 || !Array.isArray(result.body) || result.body.length > 2) refuse('rls-read');
    return result.body;
  }
  const ownProfile = await rows('user_profiles', account.accountId, 'id');
  const otherProfile = await rows('user_profiles', otherId, 'id');
  const ownSessions = await rows('sessions', account.accountId, 'id,status');
  const otherSessions = await rows('sessions', otherId, 'id');
  // The cross-profile read is a controlled denial: every account's own profile is proven visible to itself (the positive control), so an
  // empty result here is RLS, not absence. A cross-session empty result is only controlled when the other account has its own sessions.
  if (ownProfile.length !== 1 || ownProfile[0]?.id !== account.accountId || otherProfile.length !== 0 || otherSessions.length !== 0) refuse('rls-isolation');
  const internalTester = auth.body.user.app_metadata?.internal_tester === true;
  if (!internalTester) refuse('analytics-classification');
  return {authenticated: true, ownProfileVisible: true, crossProfileDenied: true, ownSessionRead: true, ownSessionCount: ownSessions.length,
    crossSessionEmpty: true, completedSessionPresent: ownSessions.some(row => row?.status === 'completed'), internalTester: true};
}
function args(argv) {
  const command = argv.shift(); const out = {};
  if (!['prepare', 'charge'].includes(command)) refuse('command');
  while (argv.length) { const key = argv.shift(), value = argv.shift(); if (!key?.startsWith('--') || value === undefined || out[key]) refuse('arguments'); out[key] = value; }
  return {command, out};
}
async function prepare(values) {
  for (const key of ['--facts', '--out-dir', '--run-id', '--source-sha', '--occurrence-file', '--occurrence-sha256']) if (!values[key]) refuse('arguments');
  if (values['--run-id'] !== RUN_ID || !SHA40.test(values['--source-sha'])) refuse('run-binding');
  const deadline = authorizedOccurrence(path.resolve(values['--occurrence-file']), values['--occurrence-sha256']);
  const outDir = path.resolve(values['--out-dir']); const stat = fs.lstatSync(outDir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700) refuse('output-parent-not-private');
  const facts = readJson(path.resolve(values['--facts']), 'facts-unreadable');
  if (!plain(facts) || !plain(facts.receipts) || !plain(facts.accounts)
      || !REF.test(facts.receipts.fence || '') || !REF.test(facts.receipts.review || '')
      || !REF.test(facts.producerReviewReference || '')) refuse('facts-prerequisites');
  // Disposition is an owner decision about the disposable account after the run, not something a read can observe: it must arrive as an
  // explicit owner reference in the input facts and is never minted here.
  if (!REF.test(facts.receipts.disp || '') || /^missing:|^r10-/.test(facts.receipts.disp)) refuse('disposition-reference-missing');
  const bundle = bundleFromEnvironment(), origin = originFor(bundle), anon = process.env.SUPABASE_ANON_KEY;
  if (typeof anon !== 'string' || !anon) refuse('anon-key-missing');
  const observations = {};
  for (const role of ROLES) {
    const other = bundle.accounts[ROLES.find(candidate => candidate !== role)].accountId;
    observations[role] = await inspectRole(origin, anon, role, bundle.accounts[role], other, deadline);
  }
  // The cross-session denial counts as controlled only when the other account's own sessions were visible to itself.
  for (const role of ROLES) {
    const otherRole = ROLES.find(candidate => candidate !== role);
    observations[role].crossSessionDenial = observations[otherRole].ownSessionCount > 0 ? 'controlled' : 'uncontrolled-other-has-no-sessions';
  }
  const receipt = {schema: 'speaksharp.cloud-test.prerequisite-preflight.v1', runId: values['--run-id'], sourceSha: values['--source-sha'],
    observedAt: new Date().toISOString(), mutationCount: 0, charges: {auth: 2, signedIn: 8, total: 10}, observations};
  const digest = sha(bytes(receipt));
  const refs = {pre: `r10-preflight:${digest}`, rls: `r10-rls:${digest}`, analytics: `r10-analytics:${digest}`};
  const augmented = {...facts, receipts: {...facts.receipts, ...refs}};
  writePrivate(path.join(outDir, 'receipt.json'), receipt);
  writePrivate(path.join(outDir, 'facts.json'), augmented);
  process.stdout.write(`prerequisite preflight prepared ${digest}\n`);
}
function charge(values) {
  for (const key of ['--receipt', '--ledger']) if (!values[key]) refuse('arguments');
  const receipt = readJson(path.resolve(values['--receipt']), 'receipt-unreadable');
  if (!plain(receipt) || receipt.schema !== 'speaksharp.cloud-test.prerequisite-preflight.v1'
      || receipt.runId !== 'R10-3b040043-smoke15' || receipt.mutationCount !== 0
      || JSON.stringify(receipt.charges) !== JSON.stringify({auth: 2, signedIn: 8, total: 10})) refuse('receipt-shape');
  const {Ledger} = require('../harness/bundle/harness/campaign-ledger.cjs');
  const identity = Ledger.inspectIdentity(path.resolve(values['--ledger']));
  const anchor = JSON.parse(fs.readFileSync(path.resolve(values['--ledger']) + '.identity', 'utf8'));
  const ledger = new Ledger(path.resolve(values['--ledger']), anchor.caps, {allowCreate: false, expectedIdentity: identity});
  try {
    if (ledger.state.reservations !== 0 || Object.keys(ledger.state.used).length !== 0) refuse('preflight-import-not-first');
    for (let index = 0; index < 2; index++) if (ledger.tryReserve(['total', 'preflight', 'auth'])) refuse('preflight-cap');
    for (let index = 0; index < 8; index++) if (ledger.tryReserve(['total', 'preflight', 'signed-in'])) refuse('preflight-cap');
  } finally { ledger.release(); }
  process.stdout.write('prerequisite preflight charged 10 existing campaign requests\n');
}
async function main(argv = process.argv.slice(2)) {
  try { const parsed = args([...argv]); if (parsed.command === 'prepare') await prepare(parsed.out); else charge(parsed.out); return 0; }
  catch (error) { process.stderr.write(`BLOCKED_SETUP: ${error?.message || 'prerequisite-preflight'}\n`); return 78; }
}
// Exports first, then the CLI entry: R10 run 42059286564 ran main() while module.exports was still empty.
module.exports = {main, prepare, charge, canonical, bytes, clock};
if (require.main === module) main().then(code => { process.exitCode = code; });

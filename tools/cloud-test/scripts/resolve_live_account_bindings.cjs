'use strict';

// Validate the owner-supplied, configuration-only live-account bundle and
// translate it into the private role/UID contract consumed by the plan builder.
// This helper never signs in, performs an admin lookup, or reads a password.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROLES = Object.freeze({
  'existing-disposable': Object.freeze({
    email: 'THROWAWAY_TEST_EMAIL',
    password: 'THROWAWAY_TEST_PASSWORD',
  }),
  'maintained-read-only': Object.freeze({
    email: 'FREE_TEST_EMAIL',
    password: 'FREE_TEST_PASSWORD',
  }),
});
const ROLE_NAMES = Object.freeze(Object.keys(ROLES));
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROJECT_REF = /^[a-z0-9]{20}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function refuse(code) {
  const error = new Error(code);
  error.code = 'BLOCKED_SETUP';
  throw error;
}

function exact(value, keys) {
  return value && !Array.isArray(value) && typeof value === 'object'
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function canonicalValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) refuse('bundle-number');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  refuse('bundle-value');
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(canonicalValue(value))}\n`, 'ascii');
}

function regularPrivateFile(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || path.resolve(file) !== file) refuse('bundle-path');
  let stat;
  try { stat = fs.lstatSync(file); } catch { refuse('bundle-missing'); }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600) refuse('bundle-not-private-regular-file');
  return stat;
}

function projectOrigin(projectRef, raw) {
  let parsed;
  try { parsed = new URL(raw); } catch { refuse('bundle-project-mismatch'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port
      || parsed.hostname !== `${projectRef}.supabase.co`
      || (parsed.pathname !== '/' && parsed.pathname !== '') || parsed.search || parsed.hash) {
    refuse('bundle-project-mismatch');
  }
  return parsed.origin;
}

function email(value) {
  if (typeof value !== 'string' || value.length > 254
      || [...value].some((character) => character.charCodeAt(0) < 0x21 || character.charCodeAt(0) > 0x7e)
      || value.split('@').length !== 2 || value.startsWith('@') || value.endsWith('@')) refuse('bundle-email');
  return value;
}

function parseBundle(bytes, expectedSha256, origin) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) refuse('bundle-missing');
  if (bytes.length > 8192) refuse('bundle-too-large');
  if (!SHA256.test(expectedSha256 || '') || sha256(bytes) !== expectedSha256) refuse('bundle-digest');
  let document;
  try { document = JSON.parse(bytes.toString('utf8')); } catch { refuse('bundle-not-json'); }
  if (!bytes.equals(canonicalBytes(document))) refuse('bundle-not-canonical');
  if (!exact(document, ['version', 'projectRef', 'accounts']) || document.version !== 1
      || !PROJECT_REF.test(document.projectRef || '') || !exact(document.accounts, ROLE_NAMES)) refuse('bundle-shape');
  const roles = {};
  for (const role of ROLE_NAMES) {
    const account = document.accounts[role];
    if (!exact(account, ['email', 'accountId'])) refuse('bundle-shape');
    email(account.email);
    if (!UUID_V4.test(account.accountId || '')) refuse('bundle-account-id');
    roles[role] = Object.freeze({
      accountId: account.accountId,
      credentialVars: ROLES[role],
    });
  }
  if (document.accounts[ROLE_NAMES[0]].email.toLowerCase() === document.accounts[ROLE_NAMES[1]].email.toLowerCase()
      || roles[ROLE_NAMES[0]].accountId === roles[ROLE_NAMES[1]].accountId) refuse('bundle-duplicate');
  return Object.freeze({
    schema: 'speaksharp.cloud-test.live-account-bindings.v1',
    projectRef: document.projectRef,
    projectOrigin: projectOrigin(document.projectRef, origin),
    sourceBundleSha256: expectedSha256,
    roles,
  });
}

function validateBindingDocument(document, {campaignId, projectOrigin: expectedOrigin} = {}) {
  if (!exact(document, ['schema', 'projectRef', 'projectOrigin', 'sourceBundleSha256', 'roles', 'campaignId'])
      || document.schema !== 'speaksharp.cloud-test.live-account-bindings.v1'
      || !PROJECT_REF.test(document.projectRef || '') || !SHA256.test(document.sourceBundleSha256 || '')
      || !exact(document.roles, ROLE_NAMES) || document.campaignId !== campaignId
      || document.projectOrigin !== projectOrigin(document.projectRef, expectedOrigin)) refuse('account-bindings-shape');
  const ids = [];
  for (const role of ROLE_NAMES) {
    const value = document.roles[role];
    if (!exact(value, ['accountId', 'credentialVars']) || !UUID_V4.test(value.accountId || '')
        || !exact(value.credentialVars, ['email', 'password'])
        || value.credentialVars.email !== ROLES[role].email || value.credentialVars.password !== ROLES[role].password) {
      refuse('account-bindings-role');
    }
    ids.push(value.accountId);
  }
  if (ids[0] === ids[1]) refuse('account-bindings-duplicate');
  return document;
}

function writePrivate(file, value) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || path.resolve(file) !== file) refuse('output-path');
  const parent = path.dirname(file);
  let parentStat;
  try { parentStat = fs.lstatSync(parent); } catch { refuse('output-parent-missing'); }
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || (parentStat.mode & 0o777) !== 0o700) refuse('output-parent-not-private');
  const bytes = canonicalBytes(value);
  let descriptor;
  try { descriptor = fs.openSync(file, 'wx', 0o600); } catch { refuse('output-exists'); }
  try { fs.writeFileSync(descriptor, bytes); } finally { fs.closeSync(descriptor); }
  return sha256(bytes);
}

function argumentsOf(argv) {
  if (argv.length !== 10) refuse('exact-arguments-required');
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--bundle', '--bundle-sha256', '--project-origin', '--campaign-id', '--out'].includes(argv[i]) || values[argv[i]]) {
      refuse('exact-arguments-required');
    }
    values[argv[i]] = argv[i + 1];
  }
  if (typeof values['--campaign-id'] !== 'string' || !values['--campaign-id'].trim()) refuse('campaign-id');
  return values;
}

function main(argv = process.argv.slice(2)) {
  try {
    const values = argumentsOf(argv);
    regularPrivateFile(values['--bundle']);
    const binding = parseBundle(fs.readFileSync(values['--bundle']), values['--bundle-sha256'], values['--project-origin']);
    const document = validateBindingDocument({...binding, campaignId: values['--campaign-id']}, {
      campaignId: values['--campaign-id'], projectOrigin: values['--project-origin'],
    });
    const digest = writePrivate(values['--out'], document);
    process.stdout.write(`live account bindings prepared ${digest}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`BLOCKED_SETUP: ${error && error.message ? error.message : 'account-binding-refused'}\n`);
    return 78;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = {ROLES, ROLE_NAMES, parseBundle, validateBindingDocument, projectOrigin, canonicalBytes, writePrivate, main};

'use strict';
// This validates a supplied authorization record. It cannot create or infer user authorization.
// The operator must retain the actual action-time owner approval outside this artifact.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
function validateSecurityApproval(record, expected, now = Date.now()) {
  const fail = why => { const e = new Error('APPROVAL_REQUIRED: ' + why); e.code = 'APPROVAL_REQUIRED'; throw e; };
  if (!record || record.version !== 1) fail('explicit action-time owner record absent');
  if (!require('./runtime-selection.cjs').supported(record.runtime) || expected.runtime !== record.runtime) fail('wrong runtime');
  if (record.action !== 'ephemeral-browser-spki-exception') fail('wrong action');
  if (!record.ownerApprovalReference || !record.approvedBy || record.approvalSource !== 'explicit-user-message') fail('missing owner approval provenance');
  if (!/^[a-f0-9]{64}$/.test(record.reviewedCodeManifestSha256 || '') || record.reviewedCodeManifestSha256 !== expected.codeManifestSha256) fail('reviewed bytes differ');
  const starts = Date.parse(record.notBefore), ends = Date.parse(record.expiresAt);
  if (!Number.isFinite(starts) || !Number.isFinite(ends) || starts > now || ends <= now || ends <= starts) fail('outside approved window');
  if (!Array.isArray(record.allowedHosts) || !record.allowedHosts.length || new Set(record.allowedHosts).size !== record.allowedHosts.length) fail('allowed hosts unbound');
  if (!expected.hosts || expected.hosts.some(h => !record.allowedHosts.includes(h))) fail('host outside approved scope');
  if (record.installTrustRoot !== false || record.globalCertificateBypass !== false || record.environmentSecurityChanges !== false) fail('prohibited expanded security scope');
  return { status: 'RECORD_VALID_NOT_RUNTIME_PROOF', action: record.action, expiresAt: record.expiresAt, ownerApprovalReference: record.ownerApprovalReference };
}
function assertSecurityApproval(opts = {}, policy) {
  if(process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('APPROVAL_REQUIRED: global TLS verification bypass is forbidden');
  if (!opts.securityApprovalFile) return validateSecurityApproval(null, {});
  const file = path.resolve(opts.securityApprovalFile);
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('APPROVAL_REQUIRED: symlink approval record');
  const root = path.resolve(__dirname, '..');
  const integrity = require('./preflight.cjs').verifyManifest(root,'CODE.sha256');
  if(integrity.result !== 'PASS') throw new Error('APPROVAL_REQUIRED: actual code differs from reviewed manifest');
  const manifest = fs.readFileSync(path.join(root, 'CODE.sha256'));
  const record=JSON.parse(fs.readFileSync(file, 'utf8'));
  const expected = { runtime: record.runtime, codeManifestSha256: sha256(manifest), hosts: Object.keys(policy?.hosts || {}) };
  return validateSecurityApproval(record, expected);
}
module.exports = { validateSecurityApproval, assertSecurityApproval };

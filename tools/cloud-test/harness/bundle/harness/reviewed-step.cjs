'use strict';
// Verifies reviewed local bytes; deliberately does NOT require/evaluate/import the step.
// Hash binding is an allowlist for trusted reviewed code, NOT an OS or Node network sandbox.
// A reviewer must inspect native fetch/http/net, child processes, dynamic imports and undeclared
// dependencies. This verifier proves only declared file identities, never absence of those APIs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const SHA = /^[0-9a-f]{64}$/;
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function realRegularFile(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some((p) => !p || p === '.' || p === '..')) throw new Error('non-canonical reviewed path');
  let cursor = root;
  for (const part of relative.split('/')) {
    cursor = path.join(cursor, part);
    const s = fs.lstatSync(cursor);
    if (s.isSymbolicLink()) throw new Error('reviewed path contains symlink');
  }
  if (!fs.lstatSync(cursor).isFile()) throw new Error('reviewed path is not a regular file');
  if (fs.realpathSync(cursor) !== cursor || !cursor.startsWith(root + path.sep)) throw new Error('reviewed path escapes root');
  return cursor;
}

function verifyReviewedStep({ manifestFile, expectedManifestSha256, stepRoot, stepFile }) {
  if (!SHA.test(expectedManifestSha256 || '')) throw new Error('independently bound manifest SHA256 required');
  const root = path.resolve(stepRoot || '');
  if (!stepRoot || root !== fs.realpathSync(root) || fs.lstatSync(root).isSymbolicLink() || !fs.lstatSync(root).isDirectory()) throw new Error('canonical reviewed step root required');
  const manifestPath = path.resolve(manifestFile || '');
  if (!manifestFile || fs.lstatSync(manifestPath).isSymbolicLink() || !fs.lstatSync(manifestPath).isFile() || fs.realpathSync(manifestPath) !== manifestPath) throw new Error('canonical regular manifest required');
  const manifestBytes = fs.readFileSync(manifestPath);
  if (hash(manifestBytes) !== expectedManifestSha256) throw new Error('reviewed manifest bytes changed');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.version !== 1 || manifest.scope !== 'trusted-reviewed-node-not-sandbox') throw new Error('review scope must explicitly disclaim Node sandbox');
  if (typeof manifest.reviewer !== 'string' || !manifest.reviewer.trim() || typeof manifest.reviewedAt !== 'string' || !/^\d{4}-\d\d-\d\dT.*Z$/.test(manifest.reviewedAt) || !Number.isFinite(Date.parse(manifest.reviewedAt))) throw new Error('named reviewer and UTC review time required');
  if (!Array.isArray(manifest.steps) || !manifest.steps.length) throw new Error('reviewed steps required');
  const resolvedStep = path.resolve(stepFile || '');
  if (!stepFile || !resolvedStep.startsWith(root + path.sep)) throw new Error('step outside reviewed root');
  const relative = path.relative(root, resolvedStep).split(path.sep).join('/');
  const matches = manifest.steps.filter((entry) => entry.path === relative);
  if (matches.length !== 1) throw new Error('step unlisted or ambiguous');
  const step = matches[0];
  if (!Array.isArray(step.dependencies)) throw new Error('declared dependency list required (empty allowed)');
  const files = [{ path: step.path, sha256: step.sha256 }, ...step.dependencies];
  if (new Set(files.map((f) => f.path)).size !== files.length) throw new Error('duplicate reviewed dependency');
  for (const file of files) {
    if (!SHA.test(file.sha256 || '')) throw new Error('reviewed file SHA256 required');
    if (hash(fs.readFileSync(realRegularFile(root, file.path))) !== file.sha256) throw new Error('reviewed file bytes changed: ' + file.path);
  }
  return { verified: true, stepPath: relative, stepSha256: step.sha256, manifestSha256: expectedManifestSha256,
    reviewer: manifest.reviewer, reviewedAt: manifest.reviewedAt, filesVerified: files.length,
    scope: manifest.scope, execution: 'NOT_PERFORMED', networkIsolation: 'NOT_PROVIDED' };
}

module.exports = { verifyReviewedStep };

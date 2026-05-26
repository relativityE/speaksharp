import { execSync, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const resultPath = path.join(rootDir, 'ci-results.json');
const ttlMs = Number(process.env.RC_GATE1_CACHE_TTL_MS ?? 5 * 60 * 1000);
const force = process.argv.includes('--force') || process.env.RC_FORCE_CI_LOCAL === '1';

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function getWorktreeEvidence() {
  const gitSha = execSync('git rev-parse HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
  const status = execSync('git status --short', { cwd: rootDir, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .sort()
    .join('\n');
  const unstagedDiff = execSync('git diff --no-ext-diff --binary', {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  const stagedDiff = execSync('git diff --cached --no-ext-diff --binary', {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });

  return {
    gitSha,
    worktreeFingerprint: sha256(JSON.stringify({ status, stagedDiff, unstagedDiff })),
  };
}

function isSuccessfulCiLocalRun(result) {
  const stages = Array.isArray(result?.stages) ? result.stages : [];
  const unit = result?.tests?.vitest;
  const e2e = result?.tests?.playwright;

  return (
    result?.status === 'success' &&
    stages.length > 0 &&
    stages.every((stage) => stage.status === 'SUCCESS') &&
    Number(unit?.failed ?? 1) === 0 &&
    Number(unit?.total ?? 0) > 0 &&
    Number(e2e?.failed ?? 1) === 0 &&
    Number(e2e?.flaky ?? 1) === 0 &&
    Number(e2e?.total ?? 0) > 0
  );
}

function readReusableResult() {
  if (force) return { reusable: false, reason: 'forced run requested' };
  if (!fs.existsSync(resultPath)) return { reusable: false, reason: 'ci-results.json is missing' };

  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  if (!isSuccessfulCiLocalRun(result)) {
    return { reusable: false, reason: 'latest ci-results.json is not a clean ci:local pass' };
  }

  const completedAt = result.rcEvidence?.completedAt;
  const completedTime = completedAt ? Date.parse(completedAt) : fs.statSync(resultPath).mtimeMs;
  const ageMs = Date.now() - completedTime;
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > ttlMs) {
    return { reusable: false, reason: `ci:local evidence is older than ${Math.round(ttlMs / 1000)}s` };
  }

  if (!result.rcEvidence?.gitSha || !result.rcEvidence?.worktreeFingerprint) {
    return { reusable: false, reason: 'ci:local evidence is missing commit/worktree fingerprint metadata' };
  }

  const current = getWorktreeEvidence();
  if (current.gitSha !== result.rcEvidence.gitSha) {
    return { reusable: false, reason: 'commit changed since ci:local completed' };
  }

  if (current.worktreeFingerprint !== result.rcEvidence.worktreeFingerprint) {
    return { reusable: false, reason: 'dirty worktree changed since ci:local completed' };
  }

  return {
    reusable: true,
    completedAt,
    ageSeconds: Math.round(ageMs / 1000),
  };
}

const reuse = readReusableResult();
if (reuse.reusable) {
  console.log(`RC_GATE_1_PRODUCT_REUSED ci:local passed ${reuse.ageSeconds}s ago for this commit and worktree.`);
  console.log(`Evidence: ${resultPath}`);
  process.exit(0);
}

console.log(`RC_GATE_1_PRODUCT_RUNNING ci:local required: ${reuse.reason}`);
const result = spawnSync('pnpm', ['ci:local'], {
  cwd: rootDir,
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);

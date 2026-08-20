#!/usr/bin/env node
//
// PR evidence contract — GENUINELY ENFORCEABLE MINIMAL CORE (#1316 regenerate/rescope).
//
// #1317 exceeded its correction budget, so its own stop rule fired: this is the regenerated
// minimal core. It claims ONLY controls that are actually operational:
//
//   * Trust: the workflow runs in base-branch context via `pull_request_target`, and the
//     validator is the base copy — a PR cannot weaken the workflow or script that judges it.
//     (org-required-workflow / required-status-check is the follow-on hardening.)
//   * Governing issue exists, predates the PR, and has a non-empty Acceptance-criteria
//     section; its hash (intent clock) is recorded.
//   * The bot owns GitHub facts: actual head SHA, base SHA, and the complete changed-file set.
//   * Exact-head full CI is green, including `pnpm quality` (the ci.yml unit-coverage-merge,
//     full-evidence, and report jobs must all succeed).
//   * No author/human attestations.
//
// DEFERRED to focused follow-ups (NOT claimed here): LIGHT/FULL tiering, trusted
// mutation/browser evidence ingestion, deployed-SHA requirements, issue-edit-triggered
// invalidation + automatic Draft conversion, telemetry, and break-glass automation.
//
// Pure module: consumes facts, returns errors / rendered text. No network or git access.

import fs from 'node:fs';
import crypto from 'node:crypto';

export const BLOCK_START = '<!-- pr-evidence-bot:v1:start -->';
export const BLOCK_END = '<!-- pr-evidence-bot:v1:end -->';
export const STATUS_ENUM = ['PENDING', 'PASS', 'FAIL'];
// The exact-head ci.yml jobs that constitute the full lane (report includes E2E aggregation;
// unit-coverage-merge runs `pnpm quality`).
export const REQUIRED_CI_JOBS = ['unit-coverage-merge', 'full-evidence', 'report'];

const REQUIRED_AUTHOR_SECTIONS = ['## User outcome', '## Scope and decisions', '## Limitations'];

export function stripComments(text) {
  return String(text ?? '').replace(/<!--[\s\S]*?-->/g, '');
}
function esc(v) { return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function extractSection(body, label) {
  const stripped = stripComments(body);
  const re = new RegExp('(?:^|\\n)#{1,6}[ \\t]*' + esc(label) + '[ \\t]*\\n([\\s\\S]*?)(?=\\n#{1,6}[ \\t]|$)', 'i');
  const m = stripped.match(re);
  return m ? m[1].trim() : null;
}

// Intent clock: normalized hash of the governing issue's Acceptance-criteria section.
export function computeAcHash(issueBody) {
  const section = extractSection(issueBody, 'Acceptance criteria');
  if (section === null) return null;
  const normalized = section
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export function acSectionNonEmpty(issueBody) {
  const s = extractSection(issueBody, 'Acceptance criteria');
  return s !== null && s.replace(/\s+/g, '').length > 0;
}

// CI status for the block. PASS only when the exact-head run completed successfully AND ran
// the full required lane (all REQUIRED_CI_JOBS succeeded). Otherwise PENDING; a failed run is FAIL.
export function ciStatusFrom({ conclusion, fullLane }) {
  if (conclusion === 'failure') return 'FAIL';
  if (conclusion === 'success' && fullLane === true) return 'PASS';
  return 'PENDING';
}

export function renderManagedBlock(facts) {
  const ordered = {
    head_sha: facts.head_sha,
    base_sha: facts.base_sha,
    changed_files: [...(facts.changed_files ?? [])].sort(),
    ac_hash: facts.ac_hash,
    ci: { status: facts.ci?.status ?? 'PENDING', link: facts.ci?.link ?? '' },
  };
  return BLOCK_START + '\n```json\n' + JSON.stringify(ordered, null, 2) + '\n```\n' + BLOCK_END;
}

export function parseManagedBlock(body) {
  const start = body.indexOf(BLOCK_START);
  const end = body.indexOf(BLOCK_END);
  if (start < 0 || end < 0 || end < start) return null;
  const m = body.slice(start + BLOCK_START.length, end).match(/```json\s*\n([\s\S]*?)```/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

export function upsertManagedBlock(body, block) {
  const start = body.indexOf(BLOCK_START);
  const end = body.indexOf(BLOCK_END);
  if (start >= 0 && end >= 0 && end > start) return body.slice(0, start) + block + body.slice(end + BLOCK_END.length);
  const sep = body.endsWith('\n') ? '\n' : '\n\n';
  return body + sep + block + '\n';
}

export function extractIssueRefs(body) {
  const set = new Set();
  for (const m of stripComments(body).matchAll(/\b(?:Refs|Fixes|Closes)\s+#(\d+)\b/gi)) set.add(Number(m[1]));
  return [...set];
}

/**
 * @param {object} input body, draft, actual{ headSha, baseSha, changedFiles, acHash,
 *   issueResolved, acPresent, acNonEmpty, issuePredates, ciConclusion, fullLane }
 */
export function validatePr(input) {
  const { body = '', draft = true, actual = {} } = input;
  const errors = [];
  const stripped = stripComments(body);

  // Issue-first (mechanical): reference exists, resolves, predates, non-empty AC.
  if (!/\b(?:Refs|Fixes|Closes)\s+#\d+\b/i.test(stripped)) {
    errors.push('A governing issue reference is required: Refs/Fixes/Closes #<number>.');
  }
  if (actual.issueResolved === false) errors.push('The governing issue could not be resolved; it must exist and predate the PR.');
  if (actual.issuePredates === false) errors.push('The governing issue must predate the PR.');
  if (actual.acPresent === false) errors.push('The governing issue has no Acceptance criteria section.');
  if (actual.acNonEmpty === false) errors.push('The governing issue Acceptance criteria section is empty.');

  // Author prose presence only (no quality judgment, no attestations).
  for (const heading of REQUIRED_AUTHOR_SECTIONS) {
    if (!new RegExp('^' + esc(heading) + '\\s*$', 'm').test(stripped)) errors.push('Missing author section: ' + heading);
  }

  const block = parseManagedBlock(body);
  if (!block) { errors.push('The bot-managed facts block is missing or unparseable.'); return errors; }
  for (const key of ['head_sha', 'base_sha', 'changed_files', 'ac_hash', 'ci']) {
    if (!(key in block)) errors.push('Managed block is missing field: ' + key);
  }
  if (block.ci && !STATUS_ENUM.includes(block.ci.status)) errors.push('Managed CI status is not a valid enum.');

  // The bot owns the facts: block must equal the actual GitHub facts.
  if (actual.headSha && block.head_sha !== actual.headSha) errors.push('Managed head_sha does not match the actual GitHub head SHA.');
  if (actual.baseSha && block.base_sha !== actual.baseSha) errors.push('Managed base_sha does not match the actual GitHub base SHA.');
  if (actual.acHash && block.ac_hash !== actual.acHash) errors.push('Managed ac_hash does not match the governing issue Acceptance-criteria hash.');
  if (actual.changedFiles) {
    const a = [...(block.changed_files ?? [])].sort().join('\n');
    const b = [...actual.changedFiles].sort().join('\n');
    if (a !== b) errors.push('Managed changed_files does not match the actual GitHub changed-file set.');
  }

  if (draft) return errors;

  // Ready-for-review: exact-head full CI (including pnpm quality) must be green.
  const expected = ciStatusFrom({ conclusion: actual.ciConclusion, fullLane: actual.fullLane });
  if (block.ci?.status !== 'PASS') errors.push('Managed CI status is not PASS.');
  if (expected !== 'PASS') errors.push('Exact-head full CI (including pnpm quality) is not green: ' + expected + '.');
  return errors;
}

// ---------------------------------------------------------------------------
// Facts assembly + CLI
// ---------------------------------------------------------------------------

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function readLines(p) { return fs.readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean); }

function loadActual() {
  const event = readJson(process.env.GITHUB_EVENT_PATH);
  const pr = event.pull_request;
  const changedFiles = process.env.PR_CHANGED_FILES_FILE ? readLines(process.env.PR_CHANGED_FILES_FILE) : null;
  let issue = null;
  if (process.env.PR_GOVERNING_ISSUE_FILE) {
    const raw = readJson(process.env.PR_GOVERNING_ISSUE_FILE);
    issue = raw && raw.number ? raw : null;
  }
  return {
    pr,
    headSha: pr.head?.sha ?? null,
    baseSha: pr.base?.sha ?? null,
    changedFiles,
    acHash: issue ? computeAcHash(issue.body ?? '') : null,
    issueResolved: Boolean(issue && issue.number),
    acPresent: issue ? extractSection(issue.body ?? '', 'Acceptance criteria') !== null : false,
    acNonEmpty: issue ? acSectionNonEmpty(issue.body ?? '') : false,
    issuePredates: issue && issue.created_at && pr.created_at ? new Date(issue.created_at) <= new Date(pr.created_at) : false,
    ciConclusion: process.env.PR_CI_CONCLUSION ?? null,
    fullLane: process.env.PR_FULL_LANE === 'true',
  };
}

function emitBlock() {
  const a = loadActual();
  const ci = { status: ciStatusFrom({ conclusion: a.ciConclusion, fullLane: a.fullLane }), link: process.env.PR_CI_LINK ?? '' };
  process.stdout.write(renderManagedBlock({
    head_sha: a.headSha, base_sha: a.baseSha, changed_files: a.changedFiles ?? [], ac_hash: a.acHash, ci,
  }));
}

function enforce() {
  const a = loadActual();
  const body = process.env.PR_BODY_FILE ? fs.readFileSync(process.env.PR_BODY_FILE, 'utf8') : (a.pr.body ?? '');
  const errors = validatePr({ body, draft: Boolean(a.pr.draft), actual: a });
  if (errors.length) { console.error(errors.map((e) => '- ' + e).join('\n')); process.exitCode = 1; return; }
  console.log('PASS: PR evidence contract (' + (a.pr.draft ? 'draft' : 'review-ready') + ')');
}

// ---------------------------------------------------------------------------
// Self-test: trust-independent defect-class mutation proof.
// ---------------------------------------------------------------------------

export function selfTestData() {
  const headSha = 'a'.repeat(40);
  const baseSha = 'b'.repeat(40);
  const changedFiles = ['AGENTS.md', 'scripts/pr-evidence-contract.mjs'];
  const acHash = 'c'.repeat(64);
  const block = renderManagedBlock({ head_sha: headSha, base_sha: baseSha, changed_files: changedFiles, ac_hash: acHash, ci: { status: 'PASS', link: 'http://ci' } });
  const body = [
    '## User outcome', 'Delete the stale-claim class with an enforceable core.', '',
    '## Scope and decisions', 'Refs #1316. Minimal core.', '',
    '## Limitations', 'Bootstrap PR.', '',
    block, '',
  ].join('\n');
  const actual = {
    headSha, baseSha, changedFiles, acHash, issueResolved: true, acPresent: true, acNonEmpty: true,
    issuePredates: true, ciConclusion: 'success', fullLane: true,
  };
  return { body, actual, headSha, baseSha, changedFiles, acHash, block };
}

export function runSelfTest() {
  const { body, actual } = selfTestData();
  const ok = validatePr({ body, draft: false, actual });
  if (ok.length) throw new Error('Validator rejected a valid review-ready PR:\n' + ok.join('\n'));

  const mutants = [
    ['equal fake head SHAs', { body: body.replaceAll('a'.repeat(40), 'd'.repeat(40)), actual }],
    ['stale base SHA', { body, actual: { ...actual, baseSha: 'e'.repeat(40) } }],
    ['stale AC hash', { body, actual: { ...actual, acHash: 'e'.repeat(64) } }],
    ['extra changed file', { body, actual: { ...actual, changedFiles: [...actual.changedFiles, 'README.md'] } }],
    ['missing changed file', { body, actual: { ...actual, changedFiles: actual.changedFiles.slice(1) } }],
    ['nonexistent governing issue', { body, actual: { ...actual, issueResolved: false } }],
    ['issue created after PR', { body, actual: { ...actual, issuePredates: false } }],
    ['empty AC section', { body, actual: { ...actual, acNonEmpty: false } }],
    ['CI not full lane', { body, actual: { ...actual, fullLane: false } }],
    ['CI failed', { body, actual: { ...actual, ciConclusion: 'failure' } }],
    ['author-forged CI PASS with no full lane', { body, actual: { ...actual, fullLane: false, ciConclusion: 'success' } }],
    ['missing managed block', { body: body.replace(/<!-- pr-evidence-bot:v1:start -->[\s\S]*<!-- pr-evidence-bot:v1:end -->/, ''), actual }],
    ['missing author section', { body: body.replace('## User outcome', '## Removed'), actual }],
    ['invalid CI status enum', { body: body.replace('"status": "PASS"', '"status": "GREENISH"'), actual }],
  ];
  for (const [name, input] of mutants) {
    if (validatePr({ ...input, draft: false }).length === 0) throw new Error('Mutant not caught: ' + name);
  }

  const once = upsertManagedBlock('## User outcome\nx\n', selfTestData().block);
  if (once !== upsertManagedBlock(once, selfTestData().block)) throw new Error('Managed block upsert is not idempotent.');
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--self-test')) { runSelfTest(); console.log('PASS: PR evidence contract self-test'); return; }
  if (args.has('--extract-issue-refs')) {
    console.log(extractIssueRefs(readJson(process.env.GITHUB_EVENT_PATH).pull_request?.body ?? '').join('\n'));
    return;
  }
  if (args.has('--emit-block')) { emitBlock(); return; }
  enforce();
}

if (import.meta.url === 'file://' + process.argv[1]) main();

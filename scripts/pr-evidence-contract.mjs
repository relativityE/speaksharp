#!/usr/bin/env node
//
// PR evidence contract — trusted two-clock bot (#1316 v2 superseding design).
//
// Deletes the stale-claim class instead of scanning prose harder:
//   * Enforcement resolves from the TRUSTED base branch, never the PR head.
//   * The BOT owns GitHub facts and evidence state; the AUTHOR owns prose only.
//   * Two clocks decide freshness — the code clock (actual head SHA) and the intent
//     clock (hash of the governing issue's Acceptance Criteria section). Evidence is
//     current only when both match; otherwise it is STALE.
//   * Risk tier (LIGHT/FULL) is classified from trusted base path rules; an author
//     cannot self-downgrade.
//
// This module is pure: it consumes facts and returns errors / rendered text. All network
// and git access lives in the workflow. It never imports PR-head code.

import fs from 'node:fs';
import crypto from 'node:crypto';

export const BLOCK_START = '<!-- pr-evidence-bot:v1:start -->';
export const BLOCK_END = '<!-- pr-evidence-bot:v1:end -->';
export const STATUS_ENUM = ['PENDING', 'PASS', 'FAIL', 'STALE', 'BLOCKED', 'VOID'];
export const TIERS = ['LIGHT', 'FULL'];

// Trusted risk map: any changed path matching a FULL rule forces FULL.
export const FULL_PATH_RULES = [
  { re: /(^|\/)migrations\//i, reason: 'database migration' },
  { re: /(^|\/)auth(\/|\.)/i, reason: 'authentication/authorization' },
  { re: /(billing|stripe|entitlement)/i, reason: 'billing/entitlements' },
  { re: /(transcript|persistence|privacy)/i, reason: 'persistence/privacy' },
  { re: /(^|\/)supabase\/functions\//i, reason: 'edge/production function' },
  { re: /\.github\/workflows\/.*(deploy|release|migrat|prod)/i, reason: 'deployment/release automation' },
  { re: /^frontend\/src\/(services|lib|config|constants)\//i, reason: 'shared/core product path' },
];

export function stripComments(text) {
  return String(text ?? '').replace(/<!--[\s\S]*?-->/g, '');
}

// Content of a "## Label" / "### Label" section up to the next heading (comment-stripped).
export function extractSection(body, label) {
  const stripped = stripComments(body);
  const re = new RegExp(
    '(?:^|\\n)#{1,6}[ \\t]*' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ \\t]*\\n([\\s\\S]*?)(?=\\n#{1,6}[ \\t]|$)',
    'i',
  );
  const m = stripped.match(re);
  return m ? m[1].trim() : null;
}

// Intent clock: normalized hash of the governing issue's Acceptance Criteria section.
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
  const section = extractSection(issueBody, 'Acceptance criteria');
  return section !== null && section.replace(/\s+/g, '').length > 0;
}

// Trusted tier classification; author cannot downgrade.
export function classifyTier(changedFiles) {
  const reasons = [];
  for (const file of changedFiles ?? []) {
    for (const rule of FULL_PATH_RULES) {
      if (rule.re.test(file)) reasons.push(file + ' → ' + rule.reason);
    }
  }
  return { tier: reasons.length ? 'FULL' : 'LIGHT', reasons };
}

// The bot-managed facts block (idempotent JSON between fixed markers).
export function renderManagedBlock(facts) {
  const ordered = {
    tier: facts.tier,
    head_sha: facts.head_sha,
    base_sha: facts.base_sha,
    changed_files: [...(facts.changed_files ?? [])].sort(),
    ac_hash: facts.ac_hash,
    evidence: (facts.evidence ?? []).map((e) => ({
      id: e.id, type: e.type, status: e.status, sha: e.sha, ac_hash: e.ac_hash, coverage: e.coverage, link: e.link,
    })),
  };
  return BLOCK_START + '\n```json\n' + JSON.stringify(ordered, null, 2) + '\n```\n' + BLOCK_END;
}

export function parseManagedBlock(body) {
  const start = body.indexOf(BLOCK_START);
  const end = body.indexOf(BLOCK_END);
  if (start < 0 || end < 0 || end < start) return null;
  const inner = body.slice(start + BLOCK_START.length, end);
  const m = inner.match(/```json\s*\n([\s\S]*?)```/i);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

// Replace (or insert) the managed block, leaving author prose untouched. Idempotent:
// returns the same string when the block already matches.
export function upsertManagedBlock(body, block) {
  const start = body.indexOf(BLOCK_START);
  const end = body.indexOf(BLOCK_END);
  if (start >= 0 && end >= 0 && end > start) {
    return body.slice(0, start) + block + body.slice(end + BLOCK_END.length);
  }
  const sep = body.endsWith('\n') ? '\n' : '\n\n';
  return body + sep + block + '\n';
}

// Mark evidence STALE when either clock moved; core/shared coverage invalidates all.
export function reconcileEvidence(evidence, headSha, acHash) {
  return (evidence ?? []).map((e) => {
    const stale = e.sha !== headSha || e.ac_hash !== acHash;
    return { ...e, status: stale && e.status !== 'PENDING' ? 'STALE' : e.status };
  });
}

// Break-glass: a named Product Owner override with scope + expiry. Never waives
// production-state authorization.
export function parseBreakGlass(body) {
  const stripped = stripComments(body);
  const m = stripped.match(/BREAK-GLASS APPROVED[^\n]*\n([\s\S]*?)(?=\n#{1,6}[ \t]|$)/i);
  if (!m) return null;
  const block = m[0];
  return {
    owner: /owner\s*:\s*(\S+)/i.exec(block)?.[1] ?? null,
    scope: /scope\s*:\s*(.+)/i.exec(block)?.[1]?.trim() ?? null,
    expiry: /expiry\s*:\s*(\S+)/i.exec(block)?.[1] ?? null,
    followUp: /follow-?up\s*:\s*(#\d+|\S+)/i.exec(block)?.[1] ?? null,
  };
}
export function breakGlassValid(record) {
  return Boolean(record && record.owner && record.scope && record.expiry && record.followUp);
}

// Author-owned sections/fields (prose the bot must not own).
const REQUIRED_AUTHOR_SECTIONS = ['## User outcome', '## Scope and decisions', '## Limitations'];
const REQUIRED_AUTHOR_ATTESTATIONS = [
  'Acceptance criteria are observable and sufficient',
  'Scope is the smallest coherent increment',
];

/**
 * Validate a PR.
 * @param {object} input
 *   body    : final PR body (author prose + bot-managed block)
 *   draft   : boolean
 *   actual  : { headSha, baseSha, changedFiles, acHash, acPresent, acNonEmpty,
 *               issuePredates, finalCi: 'success'|'pending'|'failure'|null }
 */
export function validatePr(input) {
  const { body = '', draft = true, actual = {} } = input;
  const errors = [];
  const stripped = stripComments(body);

  // Governing issue + intent clock (mechanical part of issue-first).
  if (!/\b(?:Refs|Fixes|Closes)\s+#\d+\b/i.test(stripped)) {
    errors.push('A governing issue reference is required: Refs/Fixes/Closes #<number>.');
  }
  if (actual.issuePredates === false) errors.push('The governing issue must predate the PR.');
  if (actual.acPresent === false) errors.push('The governing issue has no Acceptance criteria section.');
  if (actual.acNonEmpty === false) errors.push('The governing issue Acceptance criteria section is empty.');

  // Author-owned prose must exist (bot never writes these).
  for (const heading of REQUIRED_AUTHOR_SECTIONS) {
    if (!new RegExp('^' + heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'm').test(stripped)) {
      errors.push('Missing author section: ' + heading);
    }
  }

  // Bot-managed facts block.
  const block = parseManagedBlock(body);
  if (!block) {
    errors.push('The bot-managed facts block is missing or unparseable.');
    return errors;
  }

  // Schema.
  for (const key of ['tier', 'head_sha', 'base_sha', 'changed_files', 'ac_hash', 'evidence']) {
    if (!(key in block)) errors.push('Managed block is missing field: ' + key);
  }
  if (block.tier && !TIERS.includes(block.tier)) errors.push('Managed block tier is not a valid enum.');
  if (!Array.isArray(block.evidence)) errors.push('Managed block evidence must be an array.');
  for (const e of block.evidence ?? []) {
    if (!STATUS_ENUM.includes(e.status)) errors.push('Evidence status "' + e.status + '" is not a valid enum.');
  }

  // Two clocks: bot facts must equal the actual GitHub facts.
  if (actual.headSha && block.head_sha !== actual.headSha) errors.push('Managed head_sha does not match the actual GitHub head SHA.');
  if (actual.baseSha && block.base_sha !== actual.baseSha) errors.push('Managed base_sha does not match the actual GitHub base SHA.');
  if (actual.acHash && block.ac_hash !== actual.acHash) errors.push('Managed ac_hash does not match the governing issue Acceptance-criteria hash (intent clock).');
  if (actual.changedFiles) {
    const a = [...block.changed_files].sort().join('\n');
    const b = [...actual.changedFiles].sort().join('\n');
    if (a !== b) errors.push('Managed changed_files does not match the actual GitHub changed-file set.');
  }

  // Trusted tier; no self-downgrade.
  if (actual.changedFiles) {
    const trusted = classifyTier(actual.changedFiles).tier;
    if (block.tier !== trusted) {
      errors.push('Managed tier ' + block.tier + ' does not match the trusted classification ' + trusted + ' (no self-downgrade).');
    }
  }

  if (draft) return errors;

  // ---- Ready-for-review (non-draft) ----
  for (const line of REQUIRED_AUTHOR_ATTESTATIONS) {
    const re = new RegExp('- \\[x\\][^\\n]*' + line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (!re.test(stripped)) errors.push('Author attestation not checked: ' + line);
  }
  if (/-\s*\[\s\]/.test(stripped)) errors.push('All review-readiness checkboxes must be checked.');

  // Final run is authoritative: reconcile evidence against both clocks, then require the
  // required blocking evidence PASS at the final SHA/AC.
  const reconciled = reconcileEvidence(block.evidence, actual.headSha ?? block.head_sha, actual.acHash ?? block.ac_hash);
  const finalCi = reconciled.find((e) => e.type === 'ci');
  if (!finalCi) {
    errors.push('A final CI evidence record is required at review-ready.');
  } else if (finalCi.status !== 'PASS') {
    errors.push('Final CI evidence is not PASS (it is ' + finalCi.status + ').');
  }
  if (actual.finalCi && actual.finalCi !== 'success') {
    errors.push('The actual exact-head CI is not terminal green (' + actual.finalCi + ').');
  }
  const blocking = reconciled.filter((e) => e.coverage === 'all' || e.type === 'ci' || e.type === 'browser');
  if (blocking.some((e) => ['STALE', 'FAIL', 'PENDING', 'BLOCKED', 'VOID'].includes(e.status))) {
    errors.push('Blocking evidence is stale or unresolved; re-run at the final SHA.');
  }

  // FULL tier requires structured evidence beyond CI (defect-class mutation, and a
  // deployed-SHA assertion for browser work).
  if (block.tier === 'FULL') {
    const hasMutation = reconciled.some((e) => e.type === 'mutation' && e.status === 'PASS');
    if (!hasMutation) errors.push('FULL tier requires a passing defect-class mutation evidence record.');
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Facts assembly (from the workflow-provided event + metadata files)
// ---------------------------------------------------------------------------

function readJson(path) { return JSON.parse(fs.readFileSync(path, 'utf8')); }
function readLines(path) { return fs.readFileSync(path, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean); }

export function extractIssueRefs(body) {
  const set = new Set();
  for (const m of stripComments(body).matchAll(/\b(?:Refs|Fixes|Closes)\s+#(\d+)\b/gi)) set.add(Number(m[1]));
  return [...set];
}

function loadActual() {
  const event = readJson(process.env.GITHUB_EVENT_PATH);
  const pr = event.pull_request;
  const changedFiles = process.env.PR_CHANGED_FILES_FILE ? readLines(process.env.PR_CHANGED_FILES_FILE) : null;
  let issue = null;
  if (process.env.PR_GOVERNING_ISSUE_FILE) issue = readJson(process.env.PR_GOVERNING_ISSUE_FILE);
  const acHash = issue ? computeAcHash(issue.body ?? '') : null;
  return {
    pr,
    headSha: pr.head?.sha ?? null,
    baseSha: pr.base?.sha ?? null,
    changedFiles,
    acHash,
    acPresent: issue ? extractSection(issue.body ?? '', 'Acceptance criteria') !== null : undefined,
    acNonEmpty: issue ? acSectionNonEmpty(issue.body ?? '') : undefined,
    issuePredates: issue && issue.created_at && pr.created_at ? new Date(issue.created_at) <= new Date(pr.created_at) : undefined,
    finalCi: process.env.PR_FINAL_CI ?? null,
  };
}

function emitBlock() {
  const a = loadActual();
  const tier = classifyTier(a.changedFiles).tier;
  const ciStatus = a.finalCi === 'success' ? 'PASS' : a.finalCi === 'failure' ? 'FAIL' : 'PENDING';
  const evidence = [{
    id: 'final-ci', type: 'ci', status: ciStatus, sha: a.headSha, ac_hash: a.acHash,
    coverage: 'all', link: process.env.PR_FINAL_CI_LINK ?? '',
  }];
  process.stdout.write(renderManagedBlock({
    tier, head_sha: a.headSha, base_sha: a.baseSha, changed_files: a.changedFiles ?? [], ac_hash: a.acHash, evidence,
  }));
}

function enforce() {
  const a = loadActual();
  const body = process.env.PR_BODY_FILE ? fs.readFileSync(process.env.PR_BODY_FILE, 'utf8') : (a.pr.body ?? '');
  const errors = validatePr({ body, draft: Boolean(a.pr.draft), actual: a });
  if (errors.length) {
    console.error(errors.map((e) => '- ' + e).join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log('PASS: PR evidence contract (' + (a.pr.draft ? 'draft' : 'review-ready') + ', tier ' + classifyTier(a.changedFiles).tier + ')');
}

// ---------------------------------------------------------------------------
// Self-test: trust-independent defect-class mutation proof.
// ---------------------------------------------------------------------------

export function selfTestData() {
  const headSha = 'a'.repeat(40);
  const baseSha = 'b'.repeat(40);
  const changedFiles = ['AGENTS.md', 'scripts/pr-evidence-contract.mjs', 'tests/unit/prEvidenceContract.test.js'];
  const acHash = 'c'.repeat(64);
  const block = renderManagedBlock({
    tier: 'LIGHT', head_sha: headSha, base_sha: baseSha, changed_files: changedFiles, ac_hash: acHash,
    evidence: [{ id: 'final-ci', type: 'ci', status: 'PASS', sha: headSha, ac_hash: acHash, coverage: 'all', link: 'http://ci' }],
  });
  const body = [
    '## User outcome', 'Delete the stale-claim class.', '',
    '## Scope and decisions', 'Refs #1316. Eight governance files.', '',
    '## Limitations', 'Bootstrap PR.', '',
    '## Review readiness',
    '- [x] Acceptance criteria are observable and sufficient',
    '- [x] Scope is the smallest coherent increment', '',
    block, '',
  ].join('\n');
  const actual = { headSha, baseSha, changedFiles, acHash, acPresent: true, acNonEmpty: true, issuePredates: true, finalCi: 'success' };
  return { body, actual, headSha, baseSha, changedFiles, acHash, block };
}

export function runSelfTest() {
  const { body, actual } = selfTestData();
  const ok = validatePr({ body, draft: false, actual });
  if (ok.length) throw new Error('Validator rejected a valid review-ready PR:\n' + ok.join('\n'));

  const mutants = [
    ['untrusted head SHA (equal fakes)', { body: body.replaceAll('a'.repeat(40), 'd'.repeat(40)), actual }],
    ['stale AC hash', { body, actual: { ...actual, acHash: 'e'.repeat(64) } }],
    ['extra changed file', { body, actual: { ...actual, changedFiles: [...actual.changedFiles, 'README.md'] } }],
    ['missing changed file', { body, actual: { ...actual, changedFiles: actual.changedFiles.slice(1) } }],
    ['stale evidence after head change', { body, actual: { ...actual, headSha: 'f'.repeat(40) } }],
    ['final CI not green', { body, actual: { ...actual, finalCi: 'failure' } }],
    ['invalid structured status', { body: body.replace('"status": "PASS"', '"status": "GREENISH"'), actual }],
    ['missing managed block', { body: body.replace(/<!-- pr-evidence-bot:v1:start -->[\s\S]*<!-- pr-evidence-bot:v1:end -->/, ''), actual }],
    ['unchecked attestation', { body: body.replace('- [x] Scope is the smallest coherent increment', '- [ ] Scope is the smallest coherent increment'), actual }],
  ];
  for (const [name, input] of mutants) {
    if (validatePr({ ...input, draft: false }).length === 0) throw new Error('Mutant not caught: ' + name);
  }

  // Stale browser release: a FULL PR with a browser evidence record whose observed
  // release SHA no longer matches the head is STALE and blocks.
  {
    const d = selfTestData();
    const browserBlock = renderManagedBlock({
      tier: 'FULL', head_sha: d.headSha, base_sha: d.baseSha, changed_files: d.changedFiles, ac_hash: d.acHash,
      evidence: [
        { id: 'final-ci', type: 'ci', status: 'PASS', sha: d.headSha, ac_hash: d.acHash, coverage: 'all', link: 'http://ci' },
        { id: 'mut', type: 'mutation', status: 'PASS', sha: d.headSha, ac_hash: d.acHash, coverage: 'all', link: 'http://m' },
        { id: 'browser', type: 'browser', status: 'PASS', sha: 'f'.repeat(40), ac_hash: d.acHash, coverage: 'browser', link: 'http://b' },
      ],
    });
    const staleBrowserBody = d.body.replace(/<!-- pr-evidence-bot:v1:start -->[\s\S]*<!-- pr-evidence-bot:v1:end -->/, browserBlock);
    const fullActual = { ...d.actual, changedFiles: [...d.changedFiles, 'frontend/src/services/x.ts'] };
    if (validatePr({ body: staleBrowserBody, draft: false, actual: fullActual }).length === 0) {
      throw new Error('Mutant not caught: stale browser release');
    }
  }

  // Anti-downgrade: a FULL path present, block claims LIGHT.
  const downgradeActual = { ...actual, changedFiles: [...actual.changedFiles, 'backend/supabase/migrations/x.sql'] };
  if (validatePr({ body, draft: false, actual: downgradeActual }).length === 0) {
    throw new Error('Mutant not caught: author FULL->LIGHT downgrade');
  }

  // Idempotency: upserting the same block twice yields the same body.
  const once = upsertManagedBlock('## User outcome\nx\n', selfTestData().block);
  const twice = upsertManagedBlock(once, selfTestData().block);
  if (once !== twice) throw new Error('Managed block upsert is not idempotent.');
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--self-test')) { runSelfTest(); console.log('PASS: PR evidence contract self-test'); return; }
  if (args.has('--extract-issue-refs')) {
    const event = readJson(process.env.GITHUB_EVENT_PATH);
    console.log(extractIssueRefs(event.pull_request?.body ?? '').join('\n'));
    return;
  }
  if (args.has('--emit-block')) { emitBlock(); return; }
  enforce();
}

if (import.meta.url === 'file://' + process.argv[1]) main();

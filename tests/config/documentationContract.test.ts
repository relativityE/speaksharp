// Documentation-contract test for the product_release/ canonical documentation system.
// Runs under `pnpm test:unit` (the CI - Test Audit gate). Deterministic; reads only committed files.
// Central purpose: PROVE the section-level extraction coverage claimed by DOC_MIGRATION_LEDGER.md,
// so later consolidation PRs cannot silently drop content. Also validates the disposition and
// source-file-state vocabularies, and header-scoped metadata.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../product_release');
const read = (rel: string) => fs.readFileSync(path.join(DOCS, rel), 'utf8');

const README = read('README.md');
const LEDGER = read('DOC_MIGRATION_LEDGER.md');
const STATUS = read('RELEASE_STATUS.md');
const PRODUCT_REQUIREMENTS = read('PRODUCT_REQUIREMENTS.md'); // canonical #2 (#1038)
const ARCHITECTURE = read('ARCHITECTURE.md'); // canonical #4 (#1039)
const ENTITLEMENTS = read('ENTITLEMENTS_AND_BILLING.md'); // canonical #7 (#1053)
const QUALITY = read('QUALITY.md'); // canonical #8 (#1049)
const RELEASE_PROCESS = read('RELEASE_PROCESS.md'); // canonical #9 (#1049)
const OPERATIONS_AND_SECURITY = read('OPERATIONS_AND_SECURITY.md'); // canonical #11 (#1049)
const TESTER_GUIDE = read('TESTER_GUIDE.md'); // canonical #12 (#1050)
const TESTER_OPERATIONS = read('TESTER_OPERATIONS.md'); // canonical #13 (#1050)
const EVIDENCE_INDEX = read('EVIDENCE_INDEX.md'); // canonical #14 (#1050)
const PROGRESS_AND_NEXT_ACTION = read('PROGRESS_AND_NEXT_ACTION.md'); // canonical #6 (#1045)

// #1045: the canonical destination formerly PLANNED as `COACHING_SCORE.md` was never created and is
// replaced by `PROGRESS_AND_NEXT_ACTION.md`. The product measures personal session-over-session progress
// plus one next action — not an absolute score — so the canonical map must not carry the old name.
// Archived/historical references are deliberately out of scope (provenance is preserved).
const RETIRED_CANONICAL_NAME = 'COACHING_SCORE.md';
const CANONICAL_14 = [
  'README.md', 'PRODUCT_REQUIREMENTS.md', 'ROADMAP.md', 'ARCHITECTURE.md', 'STT.md',
  'PROGRESS_AND_NEXT_ACTION.md', 'ENTITLEMENTS_AND_BILLING.md', 'QUALITY.md', 'RELEASE_PROCESS.md',
  'RELEASE_STATUS.md', 'OPERATIONS_AND_SECURITY.md', 'TESTER_GUIDE.md', 'TESTER_OPERATIONS.md',
  'EVIDENCE_INDEX.md',
];
const METADATA_FIELDS = [
  'Status:', 'Owner:', 'Last Reviewed:', 'Last Verified:', 'Applies To:', 'Class:',
  'Authority:', 'Not Authoritative For:', 'Supersedes:', 'Evidence Sources:',
];
const CONTENT_DISPOSITIONS = ['EXTRACTED', 'EVIDENCE_ONLY', 'OPEN_GAP', 'NO_DURABLE_CONTENT'];
const FILE_STATES = ['ACTIVE', 'RETAINED_EVIDENCE', 'ARCHIVE_AT_CLOSEOUT', 'ALREADY_ARCHIVED'];
const ALLOWED_SHAS = new Set(['d31102a8', 'a21e1e52', 'a247f62c']);

// ── Substantive mapped sources: heading-source path + a unique substring in its ledger subsection ──
const SOURCES: Array<{ label: string; path: string; key: string }> = [
  // historical pinned (read from the materialized copies)
  { label: 'hist ARCHITECTURE', path: 'archive/legacy-docs/d31102a8/ARCHITECTURE.md', key: 'd31102a8/ARCHITECTURE.md' },
  { label: 'hist PRD', path: 'archive/legacy-docs/d31102a8/PRD.md', key: 'd31102a8/PRD.md' },
  { label: 'hist ROADMAP', path: 'archive/legacy-docs/d31102a8/ROADMAP.md', key: 'd31102a8/ROADMAP.md' },
  { label: 'CHANGELOG', path: 'archive/legacy-docs/d31102a8/CHANGELOG.md', key: 'd31102a8/CHANGELOG.md' },
  // current
  { label: 'PRECEDENCE.md', path: 'PRECEDENCE.md', key: '`PRECEDENCE.md`' },
  { label: 'PRD.operational', path: 'PRD.operational.md', key: '`PRD.operational.md`' },
  { label: 'PRODUCT_FEATURES', path: 'PRODUCT_FEATURES.operational.md', key: '`PRODUCT_FEATURES.operational.md`' },
  { label: 'SESSION_PROGRESS', path: 'SPEAKSHARP_SESSION_PROGRESS.operational.md', key: '`SPEAKSHARP_SESSION_PROGRESS.operational.md`' },
  { label: 'ARCHITECTURE.operational', path: 'ARCHITECTURE.operational.md', key: '`ARCHITECTURE.operational.md`' },
  { label: 'CODEBASE_MAP.md', path: 'CODEBASE_MAP.md', key: '`CODEBASE_MAP.md`' },
  { label: 'STT_BASELINE', path: 'STT_BASELINE_CONTRACTS.operational.md', key: '`STT_BASELINE_CONTRACTS.operational.md`' },
  { label: 'ACCURACY_LEVERS', path: 'PRIVATE_STT_ACCURACY_LEVERS.md', key: '`PRIVATE_STT_ACCURACY_LEVERS.md`' },
  { label: 'perf-proof', path: 'stt-perf-proof-protocol.md', key: '`stt-perf-proof-protocol.md`' },
  { label: 'SOFTWARE_QUALITY', path: 'SOFTWARE_QUALITY.operational.md', key: '`SOFTWARE_QUALITY.operational.md`' },
  { label: 'QUALITY_METRICS', path: 'QUALITY_METRICS.md', key: '`QUALITY_METRICS.md`' },
  { label: 'SERVICE_LEVELS', path: 'SERVICE_LEVELS.operational.md', key: '`SERVICE_LEVELS.operational.md`' },
  { label: 'RC_GATES', path: 'RC_GATES.md', key: '`RC_GATES.md`' },
  { label: 'RC_TEST_INVENTORY', path: 'RC_TEST_INVENTORY.md', key: '`RC_TEST_INVENTORY.md`' },
  { label: 'RELEASE_RECOVERY', path: 'RELEASE_RECOVERY.md', key: '`RELEASE_RECOVERY.md`' },
  { label: 'RELEASE_CLOSEOUT', path: 'RELEASE_CLOSEOUT_LEDGER.md', key: '`RELEASE_CLOSEOUT_LEDGER.md`' },
  { label: 'BACKLOG', path: 'BACKLOG.md', key: 'BACKLOG · ' },
  { label: 'LAUNCH_ENV', path: 'LAUNCH_ENV_CHECKLIST.md', key: '`LAUNCH_ENV_CHECKLIST.md`' },
  { label: 'ENV_INVENTORY', path: 'ENV_INVENTORY.md', key: '`ENV_INVENTORY.md`' },
  { label: 'SECRET_ROTATION', path: 'SECRET_ROTATION_RUNBOOK.md', key: '`SECRET_ROTATION_RUNBOOK.md`' },
  { label: 'PAID_OPS', path: 'PAID_OPS_HARDENING_RUNBOOK.md', key: '`PAID_OPS_HARDENING_RUNBOOK.md`' },
  { label: 'OPS_HEALTH', path: 'OPS_HEALTH_DASHBOARD.md', key: '`OPS_HEALTH_DASHBOARD.md`' },
  { label: 'SCA_EXCEPTIONS', path: 'SCA_EXCEPTIONS.md', key: '`SCA_EXCEPTIONS.md`' },
  { label: 'INTERNAL_TEST', path: 'INTERNAL_TEST_PROTOCOL.md', key: '`INTERNAL_TEST_PROTOCOL.md`' },
  { label: 'MANUAL_HARDWARE', path: 'MANUAL_HARDWARE_VALIDATION.md', key: '`MANUAL_HARDWARE_VALIDATION.md`' },
  { label: 'TESTER_INSTRUCTIONS', path: 'SOFT_RELEASE_TESTER_INSTRUCTIONS.md', key: '`SOFT_RELEASE_TESTER_INSTRUCTIONS.md`' },
  { label: 'PUBLIC_LAUNCH', path: 'PUBLIC_LAUNCH_LEDGER.md', key: '`PUBLIC_LAUNCH_LEDGER.md`' },
  { label: 'ENTITLEMENT_EVIDENCE', path: 'ENTITLEMENT_PRO_LIMIT_EVIDENCE.md', key: '`ENTITLEMENT_PRO_LIMIT_EVIDENCE.md`' },
];

// Explicit, heading-level allowlist for intentionally grouped / provenance-only headings, WITH a reason.
// (CODEBASE_MAP is NOT allowlisted — its 8 sections are enumerated individually in the ledger.)
function allowReason(label: string, heading: string): string | null {
  // The historical CHANGELOG is provenance-only (git history + RELEASE_STATUS are the truth); the
  // Product Owner permits grouping it as one NO_DURABLE_CONTENT row. This covers its version H2s
  // (`[x.y.z] - date`) and their change-type H3 sub-entries (Added/Fixed/Changed/...). This is the
  // ONLY whole-source allowance; every other source (incl. CODEBASE_MAP) is enumerated per heading.
  if (label === 'CHANGELOG') return 'CHANGELOG version/change entries — provenance-only, grouped as one NO_DURABLE_CONTENT row (permitted exception).';
  void heading;
  return null;
}

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'are', 'was', 'not', 'its', 'per', 'via', 'all', 'each', 'any', 'new', 'use', 'only', 'vs', 'onto', 'must', 'when', 'what', 'how']);
// heading normalization strips parenthetical qualifiers; subsection normalization KEEPS them
// (grouped rows legitimately enumerate members inside a parenthetical list).
const norm = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const keepNorm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const toks = (s: string) => norm(s).split(' ').filter(w => w.length >= 3 && !STOP.has(w));

// A stable identifier a heading and its ledger row share verbatim (advisory code, gate id, section letter).
function idOf(heading: string): string | null {
  const m = heading.match(/^(GHSA-[0-9a-z]+)/i) || heading.match(/^(PL-\d+)/)
    || heading.match(/^(A\.\d+)/) || heading.match(/^(Lever \d+)/) || heading.match(/^(Gate \d+)/)
    || heading.match(/^([A-Z]\.)\s/) || heading.match(/^(\d+\.)\s/);
  return m ? m[1] : null;
}

function ledgerSubsection(key: string): string {
  const s3 = LEDGER.slice(LEDGER.indexOf('## 3. Section-level'));
  const blocks = s3.split(/^#### /m);
  const hit = blocks.find(b => b.includes(key));
  return hit ?? '';
}

function h2Headings(md: string): string[] {
  return [...md.matchAll(/^##\s+(.+)$/gm)].map(m => m[1].trim());
}
// Headings in SOURCE ORDER, so each H3 can be tied to its nearest preceding H2 (its actual parent).
function orderedHeadings(md: string): Array<{ level: 2 | 3; text: string }> {
  const out: Array<{ level: 2 | 3; text: string }> = [];
  for (const line of md.split('\n')) {
    const m3 = /^###\s+(.+)$/.exec(line);
    if (m3) { out.push({ level: 3, text: m3[1].trim() }); continue; }
    const m2 = /^##\s+(.+)$/.exec(line);
    if (m2) out.push({ level: 2, text: m2[1].trim() });
  }
  return out;
}

// An H3 passes ONLY when it is directly covered, or its ACTUAL parent H2 (nearest preceding) is
// covered by a ledger row. A covered unrelated H2 elsewhere in the file does NOT satisfy it.
function h3Coverage(
  ordered: Array<{ level: 2 | 3; text: string }>,
  subRaw: string,
  allowlisted: (h: string) => boolean = () => false,
): { failures: string[]; direct: number; viaParent: number } {
  let parent: string | null = null;
  const failures: string[] = [];
  let direct = 0;
  let viaParent = 0;
  for (const h of ordered) {
    if (h.level === 2) { parent = h.text; continue; }
    if (allowlisted(h.text)) continue;
    if (covered(h.text, subRaw)) { direct++; continue; }
    if (parent && covered(parent, subRaw)) { viaParent++; continue; }
    failures.push(h.text);
  }
  return { failures, direct, viaParent };
}

function covered(heading: string, subRaw: string): boolean {
  const id = idOf(heading);
  if (id && subRaw.includes(id)) return true;              // shared stable identifier
  const subNorm = keepNorm(subRaw);
  const h = norm(heading);
  if (h && subNorm.includes(h)) return true;               // heading (qualifiers stripped) is a substring
  const ts = toks(heading);
  if (ts.length === 0) return true;
  const present = ts.filter(t => subNorm.includes(t)).length;
  return present / ts.length >= 0.6;                       // ≥60% of significant tokens present
}

function tableDataRows(section: string): string[][] {
  return section.split('\n')
    .filter(l => l.trim().startsWith('|') && !/^\|[\s:|-]+\|$/.test(l.trim()))
    .filter(l => !/Atomic (content|claim)|^\|\s*Source\s*\||^\|\s*Heading|Source · Heading|Heading\(s\)|Heading group/.test(l))
    .map(l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()));
}

describe('documentation contract — product_release/', () => {
  it('README §2 declares exactly the approved 14 canonical documents', () => {
    const sec = LEDGER; // names also checked in ledger §1; README parsed here
    const readmeSec = README.slice(README.indexOf('## 2. The 14 canonical documents'));
    const names = [...readmeSec.slice(0, readmeSec.indexOf('\n## 3')).matchAll(/^\|\s*\d+\s*\|\s*\*\*([A-Za-z_]+\.md)\*\*/gm)].map(m => m[1]);
    expect(names.length).toBe(14);
    expect(new Set(names)).toEqual(new Set(CANONICAL_14));
    expect(sec).toContain('EVIDENCE_INDEX.md');
  });

  it('every pre-foundation root Markdown source is mapped in the ledger', () => {
    const rootMd = fs.readdirSync(DOCS).filter(f => f.endsWith('.md'));
    const foundation = new Set(['README.md', 'DOC_MIGRATION_LEDGER.md', 'RELEASE_STATUS.md']);
    const unmapped = rootMd.filter(f => !foundation.has(f) && !LEDGER.includes(f));
    expect(unmapped).toEqual([]);
  });

  // ── the central check: section-level coverage is REAL ──
  it('every substantive source has its own ledger subsection', () => {
    const missing = SOURCES.filter(s => ledgerSubsection(s.key) === '').map(s => s.label);
    expect(missing, 'sources with no ledger subsection').toEqual([]);
  });

  it('every H2 heading of every substantive source is covered in its ledger subsection (or allowlisted with a reason)', () => {
    const failures: string[] = [];
    for (const src of SOURCES) {
      const subRaw = ledgerSubsection(src.key);
      for (const h of h2Headings(read(src.path))) {
        if (allowReason(src.label, h)) continue; // heading-level allowlist (provenance)
        if (!covered(h, subRaw)) failures.push(`${src.label} :: ${h}`);
      }
    }
    expect(failures, `uncovered H2 headings:\n${failures.join('\n')}`).toEqual([]);
  });

  it('every H3 heading is covered directly, or under its ACTUAL nearest-preceding H2 parent', () => {
    const failures: string[] = [];
    for (const src of SOURCES) {
      const subRaw = ledgerSubsection(src.key);
      const ordered = orderedHeadings(read(src.path));
      const r = h3Coverage(ordered, subRaw, (h) => allowReason(src.label, h) !== null);
      r.failures.forEach(f => failures.push(`${src.label} :: ### ${f}`));
    }
    expect(failures, `uncovered H3 headings:\n${failures.join('\n')}`).toEqual([]);
  });

  it('H3 coverage uses the ACTUAL parent H2, not any covered H2 (negative regression)', () => {
    // A covered UNRELATED H2 must NOT rescue an H3 whose real parent is uncovered.
    const negative = h3Coverage(
      [{ level: 2, text: 'Alpha Covered' }, { level: 2, text: 'Beta Uncovered' }, { level: 3, text: 'Gamma Child' }],
      'Alpha Covered',
    );
    expect(negative.failures).toEqual(['Gamma Child']); // parent is Beta (uncovered) → FAIL despite Alpha covered
    // The actual parent being covered → PASS.
    const positive = h3Coverage(
      [{ level: 2, text: 'Delta Covered' }, { level: 3, text: 'Epsilon Child' }],
      'Delta Covered',
    );
    expect(positive.failures).toEqual([]);
  });

  it('every §3 table row carries exactly one valid content disposition (last cell)', () => {
    const s3 = LEDGER.slice(LEDGER.indexOf('## 3. Section-level'), LEDGER.indexOf('## 4.'));
    const bad: string[] = [];
    for (const cells of tableDataRows(s3)) {
      const last = cells[cells.length - 1];
      if (!CONTENT_DISPOSITIONS.includes(last)) bad.push(last);
    }
    expect(bad, `invalid content-disposition cells: ${JSON.stringify([...new Set(bad)])}`).toEqual([]);
  });

  it('every §2 file-level row uses a valid content disposition and a valid source-file state', () => {
    const s2 = LEDGER.slice(LEDGER.indexOf('## 2. File-level summary'), LEDGER.indexOf('### 2.1'));
    const badDisp: string[] = [];
    const badState: string[] = [];
    for (const cells of tableDataRows(s2)) {
      if (cells.length < 5) continue;
      const [, , content, fileState] = cells;
      if (!CONTENT_DISPOSITIONS.some(d => content.includes(d))) badDisp.push(content);
      if (!FILE_STATES.some(s => fileState.includes(s))) badState.push(fileState);
    }
    expect(badDisp, `invalid §2 content dispositions: ${JSON.stringify(badDisp)}`).toEqual([]);
    expect(badState, `invalid §2 source-file states: ${JSON.stringify(badState)}`).toEqual([]);
  });

  it('SUPERSEDED is not used as a content disposition anywhere in the ledger tables', () => {
    const tableLines = LEDGER.split('\n').filter(l => l.trim().startsWith('|'));
    expect(tableLines.some(l => /\|\s*SUPERSEDED\s*\|/.test(l))).toBe(false);
  });

  it('the canonical map carries PROGRESS_AND_NEXT_ACTION.md and NOT the retired COACHING_SCORE.md (#1045)', () => {
    expect(CANONICAL_14).toContain('PROGRESS_AND_NEXT_ACTION.md');
    expect(CANONICAL_14).not.toContain(RETIRED_CANONICAL_NAME);

    // No CURRENT authority may still ROUTE to the retired name. Archived provenance is untouched and is
    // deliberately not scanned — history keeps its original wording.
    // Scan EVERY canonical document that currently exists (plus the ledger), not a hand-picked subset,
    // so a stale pointer cannot survive in a file nobody thought to list.
    const scanned = [...CANONICAL_14, 'DOC_MIGRATION_LEDGER.md']
      .filter(n => n !== 'PROGRESS_AND_NEXT_ACTION.md')
      .filter(n => fs.existsSync(path.join(DOCS, n)));
    expect(scanned.length, 'expected several canonical docs to scan').toBeGreaterThan(5);
    for (const name of scanned) {
      expect(read(name), `${name} still references the retired ${RETIRED_CANONICAL_NAME}`)
        .not.toContain(RETIRED_CANONICAL_NAME);
    }

    // The successor may name its predecessor EXACTLY ONCE, and only as `Supersedes:` provenance — that
    // is an honest record of what it replaced, not a live route. Anywhere else would be a stale pointer.
    const successor = PROGRESS_AND_NEXT_ACTION.split('\n');
    const mentions = successor.filter(l => l.includes(RETIRED_CANONICAL_NAME));
    expect(mentions, 'the successor must name the retired doc exactly once').toHaveLength(1);
    expect(mentions[0].startsWith('**Supersedes:**'),
      'the only mention of the retired name must be the Supersedes provenance line').toBe(true);
  });

  it('PROGRESS_AND_NEXT_ACTION.md prohibits absolute scores, grades and cross-user comparison (#1045)', () => {
    const doc = read('PROGRESS_AND_NEXT_ACTION.md');
    // The prohibitions are the contract's reason for existing — they must be stated, not implied.
    for (const phrase of [
      'No universal or absolute score',
      'No grade',
      'No cross-user comparison',
      'overall speaking quality',
      'evidence input',
    ]) {
      expect(doc, `PROGRESS_AND_NEXT_ACTION.md must state: ${phrase}`).toContain(phrase);
    }
    // clarity_score is named as a legacy internal input, never as the product model.
    expect(doc).toContain('clarity_score');
    expect(doc).toContain('legacy internal implementation names');
  });

  it('the 10 metadata fields appear within the document header (first 25 lines), not merely anywhere', () => {
    for (const [label, md] of [['README', README], ['RELEASE_STATUS', STATUS], ['LEDGER', LEDGER], ['PRODUCT_REQUIREMENTS', PRODUCT_REQUIREMENTS], ['ARCHITECTURE', ARCHITECTURE], ['ENTITLEMENTS', ENTITLEMENTS], ['QUALITY', QUALITY], ['RELEASE_PROCESS', RELEASE_PROCESS], ['OPERATIONS_AND_SECURITY', OPERATIONS_AND_SECURITY], ['TESTER_GUIDE', TESTER_GUIDE], ['TESTER_OPERATIONS', TESTER_OPERATIONS], ['EVIDENCE_INDEX', EVIDENCE_INDEX], ['PROGRESS_AND_NEXT_ACTION', PROGRESS_AND_NEXT_ACTION]] as const) {
      const header = md.split('\n').slice(0, 25).join('\n');
      const missing = METADATA_FIELDS.filter(f => !header.includes(f));
      expect(missing, `${label} header missing fields`).toEqual([]);
    }
  });

  it('relative links in the governed docs resolve', () => {
    for (const [name, md] of [['README.md', README], ['DOC_MIGRATION_LEDGER.md', LEDGER], ['RELEASE_STATUS.md', STATUS], ['PRODUCT_REQUIREMENTS.md', PRODUCT_REQUIREMENTS], ['ARCHITECTURE.md', ARCHITECTURE], ['ENTITLEMENTS_AND_BILLING.md', ENTITLEMENTS], ['QUALITY.md', QUALITY], ['RELEASE_PROCESS.md', RELEASE_PROCESS], ['OPERATIONS_AND_SECURITY.md', OPERATIONS_AND_SECURITY], ['TESTER_GUIDE.md', TESTER_GUIDE], ['TESTER_OPERATIONS.md', TESTER_OPERATIONS], ['EVIDENCE_INDEX.md', EVIDENCE_INDEX], ['PROGRESS_AND_NEXT_ACTION.md', PROGRESS_AND_NEXT_ACTION]] as const) {
      for (const m of md.matchAll(/\]\((\.\.?\/[^)#]+)/g)) {
        expect(fs.existsSync(path.resolve(DOCS, m[1])), `${name}: broken link ${m[1]}`).toBe(true);
      }
    }
  });

  it('each retained-evidence file has an exact off-root destination', () => {
    expect(LEDGER).toContain('evidence/PUBLIC_LAUNCH_LEDGER.md');
    expect(LEDGER).toContain('evidence/ENTITLEMENT_PRO_LIMIT_EVIDENCE.md');
    expect(LEDGER).toContain('archive/attribution-sanitation-crosswalk.md');
  });

  it('#1037 evidence classes remain truthful and non-comparable in the canonical index', () => {
    for (const phrase of [
      'corpus_fixture',
      'browser_journey',
      'exactly `unverified`',
      '`audio_route_proven=false`',
      'production-worker runtime',
      'one thread requested/configured',
      'effective worker thread count is unreported',
      'no cross-lane ranking or winner',
      'retained for one day',
    ]) {
      expect(EVIDENCE_INDEX, `EVIDENCE_INDEX must preserve #1037 boundary: ${phrase}`).toContain(phrase);
    }
    expect(EVIDENCE_INDEX).toContain('Current pass/fail, deployed SHA, run IDs, and #1037 closure status belong only in `RELEASE_STATUS.md`');
  });

  it('the resolved #1033 attribution gap is not preserved as an open/unmerged claim', () => {
    // #1033 is merged, migrated, deployed, and live-proven — the ledger must not carry the stale
    // "still open / unmerged" phrasings that once described it. (Accurate #1033 status lives in
    // RELEASE_STATUS.md; this guard only rejects the specific resolved-gap phrasings.)
    const stalePhrases = [
      'unmerged PR #1033',
      '#1033 remains an OPEN GAP',
      'Durable engine-attribution: OPEN GAP',
    ];
    const preserved = stalePhrases.filter((p) => LEDGER.includes(p));
    expect(preserved, `stale #1033 open-gap status preserved in ledger: ${JSON.stringify(preserved)}`).toEqual([]);
  });

  it('volatile git SHAs appear only in RELEASE_STATUS (README + ledger carry only pinned provenance)', () => {
    for (const [name, md] of [['README.md', README], ['DOC_MIGRATION_LEDGER.md', LEDGER]] as const) {
      const shas = [...md.matchAll(/\b([0-9a-f]{8})(?:[0-9a-f]{32})?\b/g)].map(m => m[1]);
      expect(shas.filter(s => !ALLOWED_SHAS.has(s)), `${name} non-pinned SHA(s)`).toEqual([]);
    }
  });

  it('closeout arithmetic proves exactly 14 root files', () => {
    expect(LEDGER).toMatch(/2 retained \+ 12 new = \*\*14\*\*/);
  });
});

/**
 * #1258 — THE CURRENCY GUARD.
 *
 * `AGENTS.md` sends every agent to `RELEASE_STATUS.md` and `ACTIVE_COORDINATION.md` first, so a stale
 * value here does not merely mislead a reader — it becomes wrong work. #1358 corrected a five-week
 * drift, and one day later both files were stale again: they named a superseded baseline, described
 * #1304 Task 3 and Task 4 as "not started" after both had merged, and still named the retention
 * production proof as the release blocker after the stopping rule had fired.
 *
 * A date field cannot catch that — the stale files carried a fresh date. What these assert is INTERNAL
 * CONTRADICTION: the same fact stated two ways in two places, or a task described as both merged and
 * unstarted. They read only committed files, so they run in CI without network access.
 */
/** Parse the fixed-field CURRENCY-BLOCK. Prose is deliberately not consulted. */
function currencyBlock(markdown: string): Record<string, string> {
  const match = /<!-- CURRENCY-BLOCK\n([\s\S]*?)-->/.exec(markdown);
  if (!match) return {};
  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon <= 0) continue;
    fields[trimmed.slice(0, colon).trim()] = trimmed.slice(colon + 1).trim();
  }
  return fields;
}

describe('#1258 currency guard — the two agent-starting SSOTs must not contradict reality', () => {
  const COORDINATION = read('ACTIVE_COORDINATION.md');
  const status = currencyBlock(STATUS);
  const coordination = currencyBlock(COORDINATION);

  it('both SSOTs carry a currency block', () => {
    expect(Object.keys(status).length, 'RELEASE_STATUS has no CURRENCY-BLOCK').toBeGreaterThan(5);
    expect(Object.keys(coordination).length, 'ACTIVE_COORDINATION has no CURRENCY-BLOCK').toBeGreaterThan(5);
  });

  it('they agree on the baseline and the deployed release', () => {
    // Written at different times by different edits; a divergence is the first symptom of one being
    // left behind, which is exactly how the previous revision went stale.
    expect(coordination.baseline).toBe(status.baseline);
    expect(coordination['deployed-release']).toBe(status['deployed-release']);
    expect(status.baseline).toMatch(/^[0-9a-f]{40}$/);
  });

  it('the baseline SHA appears in the prose of BOTH files', () => {
    // The block is the machine-readable copy; if the human-readable text still names an older commit,
    // a reader and the guard would disagree.
    const short = status.baseline.slice(0, 8);
    expect(STATUS).toContain(short);
    expect(COORDINATION).toContain(short);
  });

  it('the recorded baseline is a REAL, RECENT ancestor of this checkout', () => {
    // The check that actually measures staleness. "Both files agree" and "the SHA appears in the
    // prose" are both satisfied by a superseded commit — `5f378898` is still named in RELEASE_STATUS
    // as a worked example, so a mutant that set the baseline back to it passed every other assertion
    // here. Distance from HEAD is the thing that cannot be faked by editing prose.
    let distance: number;
    try {
      execFileSync('git', ['cat-file', '-e', `${status.baseline}^{commit}`], { stdio: 'pipe' });
      distance = Number(
        execFileSync('git', ['rev-list', '--count', `${status.baseline}..HEAD`], { encoding: 'utf8' }).trim(),
      );
    } catch (error) {
      throw new Error(
        `recorded baseline ${status.baseline} is not a commit in this repository: `
        + `${(error as Error).message.split('\n')[0]}`,
      );
    }
    expect(Number.isFinite(distance)).toBe(true);
    // Generous, because a long-running branch legitimately drifts — but a board thirty commits behind
    // is describing a product state that no longer exists, which is the failure this exists to catch.
    expect(distance, `baseline is ${distance} commits behind HEAD — currentize the SSOTs`)
      .toBeLessThanOrEqual(25);
  });

  it('the block agrees with the CURRENT-baseline table row a reader actually consults', () => {
    // Not "appears somewhere in the file": `5f378898` is still named in RELEASE_STATUS as a worked
    // example of the product-behaviour criterion, so a mutant that set the block back to it satisfied
    // a whole-file search. The row a reader looks at is the one the block must match.
    const row = STATUS.split('\n').find((l) => l.includes('Repository `main`'));
    expect(row, 'RELEASE_STATUS has no "Repository `main`" baseline row').toBeTruthy();
    expect(row).toContain(status.baseline.slice(0, 8));

    const deployedRow = STATUS.split('\n').find((l) => l.includes('__APP_RELEASE__ ='));
    expect(deployedRow, 'RELEASE_STATUS records no verified deployed release').toBeTruthy();
    expect(deployedRow).toContain(status['deployed-release']);
  });

  it('states its own limit, rather than implying it verifies more than it can', () => {
    // This suite reads committed files and local git. It CANNOT know the tip of `origin/main`, so it
    // catches gross staleness and internal contradiction — not "written one commit ago". Saying so is
    // the difference between a guard and a false assurance.
    expect(STATUS + COORDINATION).toMatch(/currency guard/i);
  });

  it('every #1304 task state is one of the allowed values — never both merged and unstarted', () => {
    const allowed = new Set(['merged', 'open', 'not-started', 'returned', 'off-critical-path']);
    for (const [field, value] of Object.entries(coordination)) {
      if (!field.startsWith('task-') && !field.startsWith('lane-')) continue;
      expect(allowed.has(value), `${field} has unknown state "${value}"`).toBe(true);
    }
  });

  it('the merged #1304 tasks are recorded as merged', () => {
    // 3A, 3B and Task 4 were all described as NOT STARTED after merging. That is the exact regression.
    for (const task of ['task-1304-1', 'task-1304-2', 'task-1304-3a', 'task-1304-3b', 'task-1304-4']) {
      expect(coordination[task], `${task} must be merged`).toBe('merged');
    }
    expect(coordination['task-1360-recovery-copy']).toBe('merged');
  });

  it('retention is off the critical path, and is NOT the stated release blocker', () => {
    expect(status['retention-campaign']).toBe('off-critical-path');
    expect(status['release-blocker']).not.toMatch(/retention/);
    expect(status['release-blocker']).toBe('model-selection');
  });

  it('records the STT chain actually executing, including the ORT requalification', () => {
    // int8/q8 are NOT rejected candidates; a board that omits why they failed invites someone to
    // record a runtime bug as a model verdict.
    expect(COORDINATION).toMatch(/onnxruntime-web/);
    expect(COORDINATION).toMatch(/28306|28326/);
    expect(COORDINATION).toMatch(/425/);
    expect(COORDINATION).toMatch(/600/);
  });

  it('every parallel MVP lane has a recorded state, so none silently idles', () => {
    for (const lane of ['lane-stage-b', 'lane-telemetry', 'lane-billing', 'lane-1258-journey']) {
      expect(coordination[lane], `${lane} has no recorded state`).toBeTruthy();
    }
  });

  it('a fallback is defined by dependability, not by second-best WER', () => {
    // The judgement most likely to be lost between documents.
    expect(STATUS).toMatch(/fallback is not "second-lowest WER"|dependable across MORE devices/i);
  });
});

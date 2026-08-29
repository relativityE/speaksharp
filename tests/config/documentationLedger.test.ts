import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * #1367 — structural coverage for the documentation reconciliation.
 *
 * The point of these tests is that the ledger cannot silently fall behind the repository. A hand-maintained
 * inventory drifts on the first unlisted file, and a reader cannot tell a complete list from a stale one by
 * looking at it. So completeness is asserted, not inspected: the ledger's zone rows must equal the set of
 * tracked non-archive Markdown files exactly — no missing rows, no rows for files that no longer exist, no
 * duplicates.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LEDGER_REL = 'product_release/DOCUMENTATION_RECONCILIATION_LEDGER.md';
const LEDGER = fs.readFileSync(path.join(ROOT, LEDGER_REL), 'utf8');

/** Classification/status codes appear in the §2 legend tables in the same `| \`CODE\` |` shape as file rows. */
const LEGEND_CODES = new Set([
  'CANON', 'PROC', 'STAGING', 'EVIDENCE', 'WORKITEM', 'AGENT', 'DEVREF', 'LEGACY',
  'CURRENT', 'BANNERED', 'NEEDS-OWNER', 'ROUTED', 'GAP',
]);

/**
 * Enumerate from the git index, not the filesystem. `test-support/worktrees/` holds checked-out worktrees whose
 * Markdown files are untracked — walking the tree would report hundreds of them as "unclassified" and the failure
 * would be an artifact of a local checkout, not a documentation defect. The ledger's scope is tracked files, so
 * the test must ask git the same question the ledger answers.
 */
const isArchived = (rel: string) => /(^|\/)(archive|archived|_archive)\//i.test(rel);

function markdownFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '*.md'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 24 });
  return out.split('\0').filter(Boolean).filter(rel => !isArchived(rel)).sort();
}

/**
 * Only §3–§9 enumerate files. §10's evidence tables legitimately cite source paths (`.ts`/`.tsx`) that are not
 * documentation, so parsing the whole file would mix audit citations into the inventory.
 */
function zoneRowKeys(): string[] {
  const start = LEDGER.indexOf('## 3. Zone A');
  const end = LEDGER.indexOf('## 10. Claim-by-claim');
  expect(start, 'ledger §3 heading missing').toBeGreaterThan(-1);
  expect(end, 'ledger §10 heading missing').toBeGreaterThan(start);
  return LEDGER.slice(start, end)
    .split('\n')
    .map(line => /^\|\s*`([^`]+)`/.exec(line)?.[1])
    .filter((k): k is string => !!k && !LEGEND_CODES.has(k));
}

describe('#1367 documentation ledger — completeness', () => {
  it('classifies every tracked non-archive Markdown file, with none missing', () => {
    const keys = new Set(zoneRowKeys());
    const missing = markdownFiles().filter(f => !keys.has(f)).sort();
    expect(missing, `unclassified Markdown files — add a row to ${LEDGER_REL}`).toEqual([]);
  });

  it('has no ledger row for a file that does not exist', () => {
    const onDisk = new Set(markdownFiles());
    const stale = zoneRowKeys().filter(k => !onDisk.has(k)).sort();
    expect(stale, `ledger rows without a file — remove them from ${LEDGER_REL}`).toEqual([]);
  });

  it('lists every file exactly once', () => {
    const seen = new Map<string, number>();
    for (const k of zoneRowKeys()) seen.set(k, (seen.get(k) ?? 0) + 1);
    expect([...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k)).toEqual([]);
  });

  it('reconciles its stated in-scope count against the actual file count', () => {
    const actual = markdownFiles().length;
    expect(LEDGER, 'ledger §1 must state the real in-scope count').toContain(
      `| **In scope — tracked, non-archive** | **${actual}** |`,
    );
    expect(zoneRowKeys()).toHaveLength(actual);
  });
});

describe('#1367 documentation ledger — canonical set', () => {
  /** README.md §2 declares fourteen canonical documents. GAP-1 records that #3 does not yet exist. */
  const CANONICAL_14 = [
    'README.md', 'PRODUCT_REQUIREMENTS.md', 'ROADMAP.md', 'ARCHITECTURE.md', 'STT.md',
    'PROGRESS_AND_NEXT_ACTION.md', 'ENTITLEMENTS_AND_BILLING.md', 'QUALITY.md', 'RELEASE_PROCESS.md',
    'RELEASE_STATUS.md', 'OPERATIONS_AND_SECURITY.md', 'TESTER_GUIDE.md', 'TESTER_OPERATIONS.md',
    'EVIDENCE_INDEX.md',
  ];
  /** The single registered exception. Adding a second one must require changing this test deliberately. */
  const REGISTERED_ABSENT = new Set(['ROADMAP.md']);

  it('has every canonical document on disk except the registered GAP-1 deferral', () => {
    const absent = CANONICAL_14.filter(n => !fs.existsSync(path.join(ROOT, 'product_release', n)));
    expect(absent.sort()).toEqual([...REGISTERED_ABSENT].sort());
  });

  it('records the deferral as GAP-1 rather than leaving it silent', () => {
    expect(LEDGER).toContain('GAP-1');
    expect(LEDGER).toContain('#1257');
    expect(LEDGER).toContain('13 of 14 canonical documents exist');
  });
});

describe('#1367 product-status claims — the ones that were wrong', () => {
  const PR = fs.readFileSync(path.join(ROOT, 'product_release/PRODUCT_REQUIREMENTS.md'), 'utf8');

  it('keeps the four privacy-boundary claims separated', () => {
    // "transcript never reaches a server" and "transcript is never stored" are different claims, and the
    // code makes both false: storage.ts sends p_final_transcript, get-ai-suggestions forwards it to Gemini.
    for (const marker of ['Audio', 'Transcript']) expect(PR).toContain(marker);
    expect(PR).toMatch(/transcript/i);
    expect(PR, 'must not claim a blanket on-device boundary').not.toMatch(
      /nothing (you say |)(ever |)leaves your device/i,
    );
  });

  it('does not describe Personal Progress as unbuilt anywhere in the canonical set', () => {
    // It renders in slot C of every session state via SessionOverhaulView.
    const offenders: string[] = [];
    for (const name of ['PRODUCT_REQUIREMENTS.md', 'PROGRESS_AND_NEXT_ACTION.md', 'BACKLOG.md']) {
      const p = path.join(ROOT, 'product_release', name);
      if (!fs.existsSync(p)) continue;
      const text = fs.readFileSync(p, 'utf8');
      for (const line of text.split('\n')) {
        if (/personal progress/i.test(line) && /\b(not built|unbuilt|not implemented|backlog only)\b/i.test(line)) {
          offenders.push(`${name}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('states the universal-score status with a denominator, not a bare percentage', () => {
    // The ledger must be free to QUOTE "approximately 70% retired" in order to refute it; what it may not do
    // is leave a percentage standing as the status. So: the denominator must be present, the refutation must
    // be explicit, and the canonical docs must not carry the percentage at all.
    expect(LEDGER).toContain('0 live consumers');
    expect(LEDGER).toContain('refuted for want of a denominator');
    for (const rel of ['product_release/PRODUCT_REQUIREMENTS.md', 'product_release/BACKLOG.md']) {
      const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      expect(text, `${rel} states a retirement percentage without a denominator`).not.toMatch(/\d+% retired/);
    }
  });

  it('states an owner-gap count that matches the rows it is derived from', () => {
    // A hand-counted number in prose is exactly the kind of claim this ledger exists to stop. I got this
    // one wrong (34) on the first pass; asserting it means the next edit cannot quietly repeat that.
    const rows = zoneRowKeys().length && LEDGER
      .slice(LEDGER.indexOf('## 3. Zone A'), LEDGER.indexOf('## 10. Claim-by-claim'))
      .split('\n')
      .filter(l => /^\|\s*`/.test(l) && l.includes('NEEDS-OWNER')).length;
    expect(LEDGER, 'GAP-2 count must equal the NEEDS-OWNER rows').toContain(
      `**GAP-2 — ${rows} live files declare no owner.**`,
    );
  });

  it('carries the unvalidated-economics limitation into the product requirements', () => {
    expect(PR).toMatch(/not validated with users|no user research/i);
  });

  it('does not restate the stale "44 pins" count as fact', () => {
    // The ledger is allowed to name the figure while retiring it; the canonical docs are not allowed to assert it.
    for (const rel of ['product_release/PRODUCT_REQUIREMENTS.md', 'product_release/STT.md']) {
      const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      expect(text, `${rel} restates a stale pin count`).not.toMatch(/44 pins/);
    }
    expect(LEDGER, 'the ledger must mark the figure stale, not merely omit it').toMatch(/"44 pins" figure is stale/);
  });
});

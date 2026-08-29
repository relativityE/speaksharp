import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * #1367 recorded a complete claim-by-claim audit of the pre-consolidation Markdown tree.
 * The audit is retained as dated evidence; it is not a fifteenth canonical document and
 * no longer pretends that its 97 path rows describe the post-consolidation filesystem.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LEDGER_REL = 'product_release/evidence/retained/DOCUMENTATION_RECONCILIATION_LEDGER_2026-08-29.md';
const LEDGER = fs.readFileSync(path.join(ROOT, LEDGER_REL), 'utf8');
const PR = fs.readFileSync(path.join(ROOT, 'product_release/PRODUCT_REQUIREMENTS.md'), 'utf8');

describe('#1367 retained documentation audit', () => {
  it('is labelled as historical pre-consolidation evidence, not current authority', () => {
    expect(LEDGER).toMatch(/HISTORICAL EVIDENCE — pre-consolidation inventory/i);
    expect(LEDGER).toMatch(/not.*canonical document or current routing authority/i);
    expect(LEDGER).toContain('97-file non-archive Markdown surface');
  });

  it('is outside the canonical product_release root', () => {
    expect(fs.existsSync(path.join(ROOT, 'product_release/DOCUMENTATION_RECONCILIATION_LEDGER.md'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, LEDGER_REL))).toBe(true);
  });

  it('retains the denominator-backed universal-score finding', () => {
    expect(LEDGER).toContain('0 live consumers');
    expect(LEDGER).toContain('refuted for want of a denominator');
    for (const rel of ['product_release/PRODUCT_REQUIREMENTS.md', 'product_release/ROADMAP.md']) {
      const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      expect(text, `${rel} states a retirement percentage without a denominator`).not.toMatch(/\d+% retired/);
    }
  });

  it('retains the stale-pin-count correction without promoting it to current truth', () => {
    expect(LEDGER).toMatch(/"44 pins" figure is stale/);
    for (const rel of ['product_release/PRODUCT_REQUIREMENTS.md', 'product_release/STT.md']) {
      const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      expect(text, `${rel} restates a stale pin count`).not.toMatch(/44 pins/);
    }
  });
});

describe('#1367 reconciled product claims', () => {
  it('keeps audio transcription, transcript persistence and later text processing distinct', () => {
    expect(PR).toMatch(/audio/i);
    expect(PR).toMatch(/transcript/i);
    expect(PR, 'must not claim a blanket on-device boundary').not.toMatch(
      /nothing (you say |)(ever |)leaves your device/i,
    );
  });

  it('does not describe Personal Progress as unbuilt in the canonical set', () => {
    const offenders: string[] = [];
    for (const name of ['PRODUCT_REQUIREMENTS.md', 'PROGRESS_AND_NEXT_ACTION.md', 'ROADMAP.md']) {
      const text = fs.readFileSync(path.join(ROOT, 'product_release', name), 'utf8');
      for (const line of text.split('\n')) {
        if (/personal progress/i.test(line) && /\b(not built|unbuilt|not implemented|backlog only)\b/i.test(line)) {
          offenders.push(`${name}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('carries the unvalidated-economics limitation into the product requirements', () => {
    expect(PR).toMatch(/not validated with users|no user research/i);
  });
});

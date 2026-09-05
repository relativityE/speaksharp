import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #1416 — DATED EVIDENCE IS NOT EDITED TO MATCH CURRENT BEHAVIOR.
 *
 * The July 9 Beta-50 packet's Share Feedback acceptance row was rewritten to describe the redesigned
 * form: derived title, coarse browser/OS, no transcript or audio fields. Every one of those
 * statements is true of the product TODAY, and none of them is what that run proved. The columns it
 * checked existed then and were checked then.
 *
 * A proof edited to agree with the present cannot disagree with it, and disagreeing with the present
 * is the only reason to keep a dated proof at all. Once rewritten, the packet stops being evidence
 * and becomes a second, worse copy of the current documentation — while still carrying a date that
 * invites people to trust it as a record.
 *
 * Supersession belongs in the index, which is where it now is.
 */
const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel: string) => readFileSync(resolve(ROOT, 'product_release', rel), 'utf8');

const JULY_9 = 'evidence/BETA_50_RELEASE_EVIDENCE_2026-07-09.md';

describe('#1416 historical evidence immutability', () => {
  const packet = read(JULY_9);

  it('keeps the acceptance row in the contract that run actually proved', () => {
    const acceptance = packet.split('\n').find((line) => line.includes('**Acceptance:** row exists')) ?? '';
    expect(acceptance).not.toBe('');
    // The opt-in columns the July 9 run checked. They no longer exist in the product; that is the
    // point of keeping the record.
    expect(acceptance).toContain('`include_transcript = false`');
    expect(acceptance).toContain('`transcript_excerpt is null`');
    expect(acceptance).toContain('`include_audio = false`');
    expect(acceptance).toContain('`audio_attachment_note is null`');
    // Metadata carried the raw user agent then. #1404 replaced it with coarse browser/OS.
    expect(acceptance).toContain('userAgent');
  });

  it('does not describe the September form in a July artifact', () => {
    expect(packet).not.toContain('coarse parsed browser');
    expect(packet).not.toContain('no transcript or audio fields/content are submitted');
  });

  it('records the supersession in the evidence index instead', () => {
    const index = read('evidence/README.md');
    expect(index).toContain('BETA_50_RELEASE_EVIDENCE_2026-07-09.md');
    expect(index).toMatch(/#1404\s*\/\s*#1416/);
    expect(index).toContain('Superseded by');
  });
});

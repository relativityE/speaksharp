import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  FILLER_COUNT_TRACE_VERSION,
  MAX_FILLER_TRACE_EVENTS,
  clearFillerCountTrace,
  isFillerCountTraceEnabled,
  pushFillerCountTransition,
  readFillerCountTrace,
  type FillerCountTraceEvent,
} from '../fillerCountTrace';

/**
 * #1325 falsification tests for the privacy-safe filler count trace.
 *
 * These cover the helper-level mutants (1 flag-off, 4 privacy, 6 bound, 7 order, 8 schema).
 * Mutants 2/3/5 are hook-boundary defects and live in useFillerWords.test.tsx, because a helper
 * that manufactures its own events cannot prove the hook emits the right ones.
 */

const traceWindow = () => window as unknown as {
  __PRIVATE_TRANSCRIPT_TRACE__?: boolean;
  __FILLER_COUNT_TRACE__?: FillerCountTraceEvent[];
};

const enableTrace = () => { traceWindow().__PRIVATE_TRANSCRIPT_TRACE__ = true; };

const counts = (um: number, uh: number, ah: number, customTotal = 0) => ({
  um, uh, ah, custom_total: customTotal,
});

describe('#1325 fillerCountTrace — privacy-safe count transitions', () => {
  beforeEach(() => {
    delete traceWindow().__PRIVATE_TRANSCRIPT_TRACE__;
    delete traceWindow().__FILLER_COUNT_TRACE__;
  });

  afterEach(() => {
    delete traceWindow().__PRIVATE_TRANSCRIPT_TRACE__;
    delete traceWindow().__FILLER_COUNT_TRACE__;
  });

  // ---- Mutant 1: flag-off must write nothing ----
  describe('flag-off mutant: no event may be written while the flag is absent/false', () => {
    it('writes nothing and allocates no buffer when the flag is absent', () => {
      expect(isFillerCountTraceEnabled()).toBe(false);
      pushFillerCountTransition('interim_observed', counts(1, 0, 0));
      expect(readFillerCountTrace()).toEqual([]);
      expect(traceWindow().__FILLER_COUNT_TRACE__).toBeUndefined();
    });

    it('writes nothing when the flag is explicitly false', () => {
      traceWindow().__PRIVATE_TRANSCRIPT_TRACE__ = false;
      pushFillerCountTransition('final_observed', counts(2, 1, 0));
      expect(readFillerCountTrace()).toEqual([]);
      expect(traceWindow().__FILLER_COUNT_TRACE__).toBeUndefined();
    });
  });

  // ---- Mutant 4: privacy — no text may ever appear ----
  describe('privacy mutant: transcript/hypothesis/token text and raw custom labels are impossible', () => {
    it('records only canonical numeric keys — no text fields', () => {
      enableTrace();
      pushFillerCountTransition('interim_observed', counts(2, 1, 0, 3));
      const [event] = readFillerCountTrace();
      expect(Object.keys(event).sort()).toEqual(
        ['counts', 'phase', 'relativeMs', 'seq', 'version'].sort(),
      );
      expect(Object.keys(event.counts).sort()).toEqual(['ah', 'custom_total', 'uh', 'um'].sort());
      for (const value of Object.values(event.counts)) {
        expect(typeof value).toBe('number');
      }
    });

    it('drops any non-canonical key, so a raw custom-word label cannot ride along', () => {
      enableTrace();
      pushFillerCountTransition('interim_observed', {
        ...counts(1, 0, 0, 1),
        // A leaked custom label / transcript fragment must never survive.
        basically: 4,
        transcript: 'so um I think',
      } as unknown as Parameters<typeof pushFillerCountTransition>[1]);
      const [event] = readFillerCountTrace();
      expect(Object.keys(event.counts).sort()).toEqual(['ah', 'custom_total', 'uh', 'um'].sort());
      expect(JSON.stringify(event)).not.toMatch(/basically|transcript|think/i);
    });

    it('serialized trace contains no alphabetic transcript payload beyond the fixed schema words', () => {
      enableTrace();
      pushFillerCountTransition('interim_observed', counts(1, 1, 1, 2));
      pushFillerCountTransition('combined', counts(2, 1, 1, 2));
      const serialized = JSON.stringify(readFillerCountTrace());
      // Every alphabetic token in the artifact must be a fixed schema identifier: field names, phase
      // names, canonical count keys, or the version literal. Anything else would be leaked payload.
      const permitted = new Set(
        [
          'version', 'seq', 'relativeMs', 'phase', 'counts',
          'um', 'uh', 'ah', 'custom_total',
          'interim_observed', 'final_observed', 'combined',
          FILLER_COUNT_TRACE_VERSION,
        ].flatMap((identifier) => identifier.match(/[a-z]+/gi) ?? []),
      );
      const words = serialized.match(/[a-z]+/gi) ?? [];
      for (const word of words) expect(permitted.has(word)).toBe(true);
    });
  });

  // ---- Mutant 6: bounded ring buffer ----
  describe('bound mutant: the buffer may not grow beyond the cap', () => {
    it(`retains at most ${MAX_FILLER_TRACE_EVENTS} events and keeps the most recent`, () => {
      enableTrace();
      for (let i = 0; i < MAX_FILLER_TRACE_EVENTS + 25; i += 1) {
        pushFillerCountTransition('interim_observed', counts(i, 0, 0));
      }
      const trace = readFillerCountTrace();
      expect(trace.length).toBe(MAX_FILLER_TRACE_EVENTS);
      // Oldest dropped, newest retained.
      expect(trace[trace.length - 1].counts.um).toBe(MAX_FILLER_TRACE_EVENTS + 24);
    });
  });

  // ---- Mutant 7: ordering ----
  describe('order mutant: sequence and relative time must never regress', () => {
    it('emits strictly increasing seq and non-decreasing relativeMs', () => {
      enableTrace();
      for (let i = 0; i < 12; i += 1) pushFillerCountTransition('interim_observed', counts(i, 0, 0));
      const trace = readFillerCountTrace();
      for (let i = 1; i < trace.length; i += 1) {
        expect(trace[i].seq).toBeGreaterThan(trace[i - 1].seq);
        expect(trace[i].relativeMs).toBeGreaterThanOrEqual(trace[i - 1].relativeMs);
      }
    });

    it('restarts the sequence after an explicit clear (per-replay isolation)', () => {
      enableTrace();
      pushFillerCountTransition('interim_observed', counts(1, 0, 0));
      clearFillerCountTrace();
      expect(readFillerCountTrace()).toEqual([]);
      pushFillerCountTransition('interim_observed', counts(1, 0, 0));
      expect(readFillerCountTrace()[0].seq).toBe(0);
    });
  });

  // ---- Mutant 8: schema validity ----
  describe('schema mutant: malformed counts are rejected, never coerced into evidence', () => {
    it('rejects negative and non-integer counts instead of recording them', () => {
      enableTrace();
      pushFillerCountTransition('interim_observed', counts(-1, 0, 0));
      pushFillerCountTransition('interim_observed', counts(1.5, 0, 0));
      pushFillerCountTransition('interim_observed', counts(Number.NaN, 0, 0));
      expect(readFillerCountTrace()).toEqual([]);
    });

    it('rejects an unknown phase', () => {
      enableTrace();
      pushFillerCountTransition(
        'bogus_phase' as unknown as FillerCountTraceEvent['phase'],
        counts(1, 0, 0),
      );
      expect(readFillerCountTrace()).toEqual([]);
    });

    it('stamps the schema version on every accepted event', () => {
      enableTrace();
      pushFillerCountTransition('final_observed', counts(1, 2, 0));
      expect(readFillerCountTrace()[0].version).toBe(FILLER_COUNT_TRACE_VERSION);
    });
  });
});

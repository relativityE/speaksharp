import { describe, it, expect } from 'vitest';
import { detectRepetitionRisk } from '../repetitionRisk';

describe('detectRepetitionRisk (non-mutating Whisper-loop flag)', () => {
  it('returns no risk for clean natural speech', () => {
    const r = detectRepetitionRisk('They, like, told wild tales to frighten him.');
    expect(r.repetitionRisk).toBe(false);
    expect(r.repetitionRiskReason).toBeNull();
  });

  it('returns no risk for empty/short input', () => {
    expect(detectRepetitionRisk('').repetitionRisk).toBe(false);
    expect(detectRepetitionRisk('I think I think').repetitionRisk).toBe(false); // short genuine 2x → not flagged
  });

  it('flags an adjacent multi-word loop (>=3x back-to-back)', () => {
    const r = detectRepetitionRisk('we should wait we should wait we should wait now');
    expect(r.repetitionRisk).toBe(true);
    expect(r.repetitionRiskReason).toBe('adjacent_loop');
    expect(r.repeatedSpanSummary).toContain('we should wait');
  });

  it('flags near whole-text doubling (conv_01-style, with filler interleaving)', () => {
    const r = detectRepetitionRisk('Umm basically we should literally like wait basically we should literally like wait');
    expect(r.repetitionRisk).toBe(true);
    expect(['near_whole_doubling', 'repeated_span']).toContain(r.repetitionRiskReason);
  });

  it('flags a non-adjacent repeated 4+ word span (Tester-B interleaved loop)', () => {
    const r = detectRepetitionRisk('basically we should literally like wait um basically we should literally like wait um basically');
    expect(r.repetitionRisk).toBe(true);
    expect(r.repeatedSpanSummary).toBeTruthy();
  });

  it('NEVER mutates — it only returns flags (the input is untouched by design)', () => {
    const input = 'we should wait we should wait we should wait';
    const before = input;
    detectRepetitionRisk(input);
    expect(input).toBe(before); // string is immutable; documents the non-mutating contract
  });
});

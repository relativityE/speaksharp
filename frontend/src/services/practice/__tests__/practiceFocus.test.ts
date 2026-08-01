import { describe, expect, it } from 'vitest';
import {
  buildFreestyleSessionSearch,
  FREESTYLE_PROMPTS,
  getNextFreestylePrompt,
  PRACTICE_FOCUS_OPTIONS,
  resolveFreestylePrompt,
  resolvePracticeFocus,
} from '../practiceFocus';
import { PRACTICE_THIS_NEXT_LABEL } from '@/services/progress/progressPresentation';

describe('Freestyle practice focus contract', () => {
  it('keeps the approved option and prompt corpus exact and bounded', () => {
    expect(PRACTICE_FOCUS_OPTIONS.map(({ label }) => label)).toEqual([
      'Just practice',
      'Be more concise',
      'Reduce filler words',
      'Keep a steady pace',
      'Deliver clearly',
    ]);
    expect(FREESTYLE_PROMPTS.map(({ text }) => text)).toEqual([
      'Explain something you worked on recently: what it was, why it mattered, and what happened next.',
      'Give a short update: main point, current status, and next step.',
      'Describe a recent decision and why you made it.',
      'Explain a familiar process to someone new.',
      'Teach one idea using a simple example.',
    ]);
    expect(getNextFreestylePrompt(FREESTYLE_PROMPTS.length - 1)).toEqual({
      index: 0,
      prompt: FREESTYLE_PROMPTS[0],
    });
  });

  it('uses stable IDs and safely defaults malformed handoff values', () => {
    expect(resolvePracticeFocus('not-a-focus')).toBe('just-practice');
    expect(resolveFreestylePrompt('not-a-prompt')).toBeNull();
    expect(buildFreestyleSessionSearch({ focus: 'concise', promptId: 'short-update' })).toBe(
      '?focus=concise&prompt=short-update',
    );
    expect(buildFreestyleSessionSearch({ focus: 'fillers', promptId: null }, { privateTrial: true })).toBe(
      '?focus=fillers&trial=private',
    );
  });

  it('preserves the canonical follow-up action wording', () => {
    expect(PRACTICE_THIS_NEXT_LABEL).toBe('Practice this next');
  });
});

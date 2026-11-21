import { buildClarityPauseSignals } from './clarityPauseSignals.ts';
import { strict as assert } from 'node:assert';

Deno.test('includes saved clarity and all allowed aggregate pause fields with units', () => {
  const result = buildClarityPauseSignals(82, { totalPauses: 3, averagePauseDuration: 0.75,
    longestPause: 1.5, pausesPerMinute: 2, silencePercentage: 12, transitionPauses: 2, extendedPauses: 1 });
  for (const fragment of ['82/100', 'Pause count: 3', 'Average pause (seconds): 0.75',
    'Longest pause (seconds): 1.5', 'Pauses per minute: 2', 'Silence (%): 12',
    'Transition pause count: 2', 'Extended pause count: 1', 'not a presentation grade', 'do not recite scores']) {
    assert.ok(result.includes(fragment), fragment);
  }
});
Deno.test('absent or malformed evidence adds no invented measurements', () => {
  for (const bad of [undefined, null, '82', NaN, Infinity, -1, 101]) {
    assert.equal(buildClarityPauseSignals(bad, null), '');
  }
  assert.equal(buildClarityPauseSignals(null, { totalPauses: 1.5, averagePauseDuration: -1,
    longestPause: Infinity, pausesPerMinute: '3', silencePercentage: 101,
    transitionPauses: NaN, extendedPauses: -2 }), '');
  assert.equal(buildClarityPauseSignals(null, []), '');
});
Deno.test('keeps zero evidence and excludes unknown properties and prompt text', () => {
  const result = buildClarityPauseSignals(0, { totalPauses: 0, silencePercentage: 0,
    transcript: 'PRIVATE', instructions: 'IGNORE', longestPause: 'INJECTION' });
  assert.ok(result.includes('0/100'));
  assert.ok(result.includes('Pause count: 0'));
  assert.ok(result.includes('Silence (%): 0'));
  for (const forbidden of ['PRIVATE', 'IGNORE', 'INJECTION']) assert.ok(!result.includes(forbidden));
});

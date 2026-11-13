import { buildPauseSignals } from './pauseSignals.ts';
import { strict as assert } from 'node:assert';

Deno.test('a measured take sends every allowed aggregate pause field with units', () => {
  const result = buildPauseSignals({ totalPauses: 3, averagePauseDuration: 0.75,
    longestPause: 1.8, pausesPerMinute: 2, silencePercentage: 12, transitionPauses: 2, extendedPauses: 1 });
  for (const fragment of ['Pause count: 3', 'Average pause (seconds): 0.75',
    'Longest pause (seconds): 1.8', 'Pauses per minute: 2', 'Silence (%): 12',
    'Transition pause count: 2', 'Extended pause count: 1', 'do not recite the numbers']) {
    assert.ok(result.includes(fragment), fragment);
  }
});
Deno.test('an unmeasured take (missing, invalid or zero pause count) adds no pause evidence at all', () => {
  for (const bad of [undefined, null, '3', 3, [], {}]) assert.equal(buildPauseSignals(bad), '');
  // The client's reset state: every field 0. Indistinguishable from a detector that never ran, so it is not "0 pauses".
  assert.equal(buildPauseSignals({ totalPauses: 0, averagePauseDuration: 0, longestPause: 0, pausesPerMinute: 0,
    silencePercentage: 0, transitionPauses: 0, extendedPauses: 0 }), '');
  for (const totalPauses of [undefined, null, '3', 1.5, -1, NaN, Infinity]) {
    assert.equal(buildPauseSignals({ totalPauses, extendedPauses: 2, silencePercentage: 10 }), '', String(totalPauses));
  }
});
Deno.test('once pauses were measured, a real zero is kept and malformed fields are dropped', () => {
  const result = buildPauseSignals({ totalPauses: 4, extendedPauses: 0, transitionPauses: 1.5, averagePauseDuration: -1,
    longestPause: Infinity, pausesPerMinute: '3', silencePercentage: 101 });
  assert.ok(result.includes('Pause count: 4'));
  assert.ok(result.includes('Extended pause count: 0'));
  for (const dropped of ['Transition', 'Average', 'Longest', 'per minute', 'Silence']) assert.ok(!result.includes(dropped), dropped);
});
Deno.test('unknown properties and prompt text never reach the prompt', () => {
  const result = buildPauseSignals({ totalPauses: 2, silencePercentage: 0,
    transcript: 'PRIVATE', instructions: 'IGNORE', longestPause: 'INJECTION' });
  assert.ok(result.includes('Pause count: 2'));
  assert.ok(result.includes('Silence (%): 0'));
  for (const forbidden of ['PRIVATE', 'IGNORE', 'INJECTION']) assert.ok(!result.includes(forbidden));
});

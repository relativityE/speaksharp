/**
 * Saved aggregate pause evidence for the Open Mic coaching prompt. Only allowlisted numeric fields are serialized; arbitrary
 * row properties, raw audio and timestamps never reach the prompt.
 *
 * MEASURED vs UNMEASURED. The client resets every pause field to 0 at the start of a take and only overwrites them when its
 * pause detector reports, so a saved all-zero object is what an unmeasured take looks like. Saved data carries no separate
 * "measured" flag, so a take whose pause count is missing, invalid or 0 is treated as UNMEASURED and contributes nothing:
 * the model is never told "0 pauses" on evidence that cannot tell a real zero from a detector that never ran. Once a
 * positive pause count shows the detector ran, a 0 in another field (for example no extended pauses) is a real measured
 * zero and is sent.
 *
 * Clarity is deliberately NOT here: the saved clarity score is a composite of word count, fillers, error tags and WPM, and
 * the prompt already carries the fillers and WPM; a take too short to score is also saved as 0.
 *
 * "Measured" means the detector ran, not that every value is exact: for example the silence before the speaker presses
 * Stop can count as a pause. Values are checked for type and sign only and are not capped or rounded.
 */
export function buildPauseSignals(pauseMetrics: unknown): string {
  if (!pauseMetrics || typeof pauseMetrics !== 'object' || Array.isArray(pauseMetrics)) return '';
  const metrics = pauseMetrics as Record<string, unknown>;
  const total = metrics.totalPauses;
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 1) return '';
  const fields = [
    ['totalPauses', 'Pause count', true],
    ['averagePauseDuration', 'Average pause (seconds)', false],
    ['longestPause', 'Longest pause (seconds)', false],
    ['pausesPerMinute', 'Pauses per minute', false],
    ['silencePercentage', 'Silence (%)', false],
    ['transitionPauses', 'Transition pause count', true],
    ['extendedPauses', 'Extended pause count', true],
  ] as const;
  const lines: string[] = [];
  for (const [key, label, integer] of fields) {
    const value = metrics[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0
      || (integer && !Number.isSafeInteger(value))
      || (key === 'silencePercentage' && value > 100)) continue;
    lines.push(`- ${label}: ${value}`);
  }
  return `${lines.join('\n')}\n- Use the pause data as supporting delivery evidence, not proof of content quality or improvement; do not recite the numbers.`;
}

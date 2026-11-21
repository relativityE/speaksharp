/** Saved aggregate evidence only: never serialize arbitrary row properties into a prompt. */
export function buildClarityPauseSignals(clarityScore: unknown, pauseMetrics: unknown): string {
  const lines: string[] = [];
  if (typeof clarityScore === 'number' && Number.isFinite(clarityScore)
    && clarityScore >= 0 && clarityScore <= 100) {
    lines.push(`- Clarity heuristic: ${clarityScore}/100 (delivery diagnostic, not a presentation grade)`);
  }
  if (pauseMetrics && typeof pauseMetrics === 'object' && !Array.isArray(pauseMetrics)) {
    const metrics = pauseMetrics as Record<string, unknown>;
    const fields = [
      ['totalPauses', 'Pause count', true],
      ['averagePauseDuration', 'Average pause (seconds)', false],
      ['longestPause', 'Longest pause (seconds)', false],
      ['pausesPerMinute', 'Pauses per minute', false],
      ['silencePercentage', 'Silence (%)', false],
      ['transitionPauses', 'Transition pause count', true],
      ['extendedPauses', 'Extended pause count', true],
    ] as const;
    for (const [key, label, integer] of fields) {
      const value = metrics[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0
        || (integer && !Number.isSafeInteger(value))
        || (key === 'silencePercentage' && value > 100)) continue;
      lines.push(`- ${label}: ${value}`);
    }
  }
  return lines.length ? `${lines.join('\n')}\n- Use these as supporting delivery evidence, not proof of content quality or improvement; do not recite scores.` : '';
}

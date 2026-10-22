const MAX_FOCUS_LABEL_CHARS = 200;
const clockText = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const quoteLabel = (text: string): string => `"${text.replace(/[\r\n"]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_FOCUS_LABEL_CHARS)}"`;
function buildDeliverySignals(session: SessionEvidence, focusContext: FocusContext): string {
  // #1258: saves write `filler_counts` and strip `filler_words`; the legacy field is only a fallback for older rows.
  const fillerEvidence = session.filler_counts ?? session.filler_words;
  const fillers = `- Filler Words: ${fillerEvidence == null ? 'N/A' : JSON.stringify(fillerEvidence)}`;
  const pace = `- Words Per Minute (WPM): ${session.wpm ?? 'N/A'}`;
  if (focusContext.kind !== 'focus') {
    return `
      Delivery signals:
      ${pace}
      ${fillers}
    `;
  }
  const metric = (session.next_action_signal as { metric?: unknown } | null | undefined)?.metric;
  const chosen = metric === 'filler_rate' ? fillers : metric === 'wpm' ? pace : null;
  return chosen
    ? `
      Delivery signal (the one most actionable for this take):
      ${chosen}
    `
    : `
      Delivery signals: none material for this take - coach from the Focus Points results.
    `;
}
function buildFocusCoachingText(context: FocusContext): string {
  if (context.kind !== 'focus') return '';
  const lines = context.points.map((point, index) => {
    const result = point.verdict === 'detected'
      ? `detected${point.detectedAtSeconds !== null ? ` at ${clockText(point.detectedAtSeconds)}` : ''}`
      : point.verdict === 'not_detected'
        ? 'not detected by the keyword matcher (the speaker may have covered it in other words)'
        : 'not checked';
    return `      ${index + 1}. ${quoteLabel(point.label)}: ${result}`;
  });
  const allDetected = context.points.every((point) => point.verdict === 'detected');
  return `
      Focus Points session. The speaker chose these points to cover, in this order${context.topic ? `, for the topic ${quoteLabel(context.topic)}` : ''}. A keyword matcher checked the transcript for each:
${lines.join('\n')}

      Focus Points coaching rules:
      - Both phrases must help the speaker cover THESE chosen points in the next run: which point to open, introduce or signpost, where it belongs, or pacing between points, when this transcript and these results support it.
      - "Not detected" is only what the matcher found. Never say a point was missed, skipped or not mentioned; suggest how to make it unmistakable instead.
${allDetected ? '      - Every point was detected. Do not suggest covering a point as if it were missing; coach placement, transitions or pace between points.\n' : ''}`;
}
function buildCoachingPrompt(transcriptForPrompt: string, metricsText: string): string {
  return coachingContract.promptTemplate.replace(
    /\{\{(TRANSCRIPT|METRICS)\}\}/g,
    (_marker, name: string) => name === 'TRANSCRIPT' ? transcriptForPrompt : metricsText,
  );
}
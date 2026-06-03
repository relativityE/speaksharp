/**
 * Strip STT metadata tokens such as [MUSIC], [BLANK_AUDIO], *cough*, or
 * (applause) while preserving the spoken transcript text around them.
 */
export function sanitizeTranscriptText(raw: string): string {
  return raw
    .replace(/>>/g, '')
    // Strip asterisk-wrapped metadata (e.g. *cough*, *Spits*). `[^*]+` cannot cross an
    // asterisk, so this safely matches a single *…* span of ANY length — the prior
    // {1,40} cap let longer metadata tags escape to the UI/DB (review F3).
    .replace(/\*[^*]+\*/g, '')
    .replace(/\[[A-Z_\s]+\]/gi, '')
    .replace(/\([a-z\s]+\)/gi, '')
    .replace(/(?:^|[\s.?!,])(?:\d+(?:\.\d+)?)(?:\s*,\s*\d+(?:\.\d+)?)*\s*[.!?]?\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

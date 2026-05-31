/**
 * Strip STT metadata tokens such as [MUSIC], [BLANK_AUDIO], *cough*, or
 * (applause) while preserving the spoken transcript text around them.
 */
export function sanitizeTranscriptText(raw: string): string {
  return raw
    .replace(/>>/g, '')
    .replace(/\*[^*]{1,40}\*/g, '')
    .replace(/\[[A-Z_\s]+\]/gi, '')
    .replace(/\([a-z\s]+\)/gi, '')
    .replace(/(?:^|[\s.?!,])(?:\d+(?:\.\d+)?)(?:\s*,\s*\d+(?:\.\d+)?)*\s*[.!?]?\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

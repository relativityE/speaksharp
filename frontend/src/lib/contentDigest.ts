/**
 * #1259 — a one-way digest for content we must NEVER send.
 *
 * Extracted from `errorFingerprint` because transcript telemetry needs the same primitive for a very
 * different reason. F05 has to answer "is the transcript the review renders the SAME one that was
 * saved?", and the only honest way to compare two pieces of text without transmitting either is to
 * compare digests computed locally and send only the result.
 *
 * FNV-1a, 32 bits. This is a GROUPING and EQUALITY primitive, not a cryptographic one and not an
 * identifier: it says "these two strings were the same" and nothing else. It is never sent alongside
 * anything that would let the text be recovered, and it is never used where a collision would change
 * a decision — a collision here would merge two transcripts in a diagnostic, not corrupt a session.
 */
export function contentDigest(input: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i += 1) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

/**
 * Words, counted the way a reader would.
 *
 * Deliberately not `split(' ')`: a transcript arriving with newlines or doubled spaces would report a
 * word count the user's own screen contradicts, and F05 is entirely about counts that disagree with
 * what is on screen. An empty or whitespace-only string is 0, never 1.
 */
export function countWords(input: string | null | undefined): number {
    if (!input) return 0;
    const trimmed = input.trim();
    if (trimmed.length === 0) return 0;
    return trimmed.split(/\s+/).length;
}

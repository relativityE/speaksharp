/**
 * Split live draft text into completed sentences ("settled" — render calm/recognized)
 * and the trailing in-progress sentence ("active" — render as Draft). Live-view only:
 * the saved transcript still comes from the whole-utterance final decode.
 */
export function splitSettledActiveTranscript(text: string): { settled: string; active: string } {
    const trimmed = (text || '').trim();
    if (!trimmed) return { settled: '', active: '' };

    // Last sentence-ending punctuation (. ! ?), allowing a trailing closing quote/bracket.
    const terminator = /[.!?]+["'’”)\]]?/g;
    let lastEnd = -1;
    let match: RegExpExecArray | null;
    while ((match = terminator.exec(trimmed)) !== null) {
        lastEnd = match.index + match[0].length;
    }

    if (lastEnd <= 0) return { settled: '', active: trimmed };
    return {
        settled: trimmed.slice(0, lastEnd).trim(),
        active: trimmed.slice(lastEnd).trim(),
    };
}

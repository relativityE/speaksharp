import { describe, it, expect } from 'vitest';
import { resolveReviewTranscript } from '../reviewTranscript';

/**
 * F-05 — the finalized transcript must survive to the review, and the four reasons it might not be
 * there must stay distinguishable. An empty string is not an answer to any of them.
 */
const base = { transcriptState: 'available' as const, retainedText: 'the saved words', isFinalizing: false, savedSessionId: 's1' };

describe('#1416 F-05 the review transcript comes from the retained authority', () => {
    it('renders the retained text once finalization has settled', () => {
        expect(resolveReviewTranscript(base)).toEqual({ status: 'available', text: 'the saved words' });
    });

    it('does NOT report an absence while finalization is still running', () => {
        // The exact moment the defect is visible: working memory is being purged, the row may not
        // exist yet, and the UI used to render the resulting empty string as the user's transcript.
        expect(resolveReviewTranscript({ ...base, isFinalizing: true }).status).toBe('pending');
        expect(resolveReviewTranscript({ ...base, savedSessionId: null }).status).toBe('pending');
    });

    it('never infers expiry from emptiness', () => {
        // `available` with no text yet is a load in flight. Calling it expired would tell the user
        // their words aged out while the server is still holding them.
        expect(resolveReviewTranscript({ ...base, retainedText: '' }).status).toBe('pending');
        expect(resolveReviewTranscript({ ...base, retainedText: '   ' }).status).toBe('pending');
    });

    it('keeps expired and not_captured distinct — they need different sentences', () => {
        expect(resolveReviewTranscript({ ...base, transcriptState: 'expired', retainedText: '' }).status).toBe('expired');
        expect(resolveReviewTranscript({ ...base, transcriptState: 'not_captured', retainedText: '' }).status).toBe('not_captured');
    });

    it('CASUALTY: an expired session is not reported as available, whatever text is lying around', () => {
        // Server state wins over any residue in the client. If a stale buffer could override
        // `expired`, the product would show a transcript the retention policy has deleted.
        expect(resolveReviewTranscript({
            ...base, transcriptState: 'expired', retainedText: 'stale residue from another session',
        })).toEqual({ status: 'expired' });
    });

    it('CASUALTY: an unknown or absent state is pending, never available', () => {
        // Fails toward "we do not know yet" rather than toward showing something. The opposite
        // default renders whatever happens to be in memory as though it were the saved session.
        expect(resolveReviewTranscript({ ...base, transcriptState: null }).status).toBe('pending');
        expect(resolveReviewTranscript({ ...base, transcriptState: undefined }).status).toBe('pending');
    });
});

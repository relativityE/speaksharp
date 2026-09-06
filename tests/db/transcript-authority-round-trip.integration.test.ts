// @vitest-environment node
//
// #1423 T6 (W-05 / Q-02) — the DATABASE-level half of the transcript authority.
//
// The component tests on this branch prove that `ReviewTranscriptNotice` renders the four states and that an
// absent authority reads as pending. None of that proves the row. A notice can say "retained" over a row that
// stored nothing, or over a row that stored a truncated prefix of what the speaker actually said, and every
// DOM assertion in the suite would still pass.
//
// So this suite closes the loop against a REAL PostgreSQL (PGlite) running the actual migrations:
//
//   client text  ->  complete_session_v2  ->  sessions row  ->  the reader's OWN select  ->  resolveTranscriptView
//
// and asserts agreement at every hop. `resolveTranscriptView` is IMPORTED from production source, not
// restated, and the select column list is PARSED from `storage.ts`, so a drift on either side fails here
// rather than silently changing what the user is told about their own transcript.
//
// Content-free: synthetic strings only.
import { describe, it, expect } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { executableText } from '../deps/lib/source-text';
import { U, db0, newSession, complete, row } from './helpers/completionEnv';
import { resolveTranscriptView, TRANSCRIPT_STATES } from '../../frontend/src/lib/storage';

const STORAGE = resolve(process.cwd(), 'frontend', 'src', 'lib', 'storage.ts');

/**
 * The EXACT column list the single-session DETAIL read issues, parsed from the client rather than restated.
 *
 * A restated list is the failure this guards: drop `transcript_state` from the real select and the reader
 * receives a row with no state, `resolveTranscriptView` correctly falls to `unavailable`, and every user with
 * a perfectly retained transcript is told we could not load it. A hard-coded copy here would keep asserting
 * the old, correct list and stay green through exactly that regression.
 */
function readerDetailColumns(): string[] {
    const src = executableText(readFileSync(STORAGE, 'utf8'), 'slash');
    const analysis = /const SESSION_ANALYSIS_COLUMNS\s*=\s*\[([\s\S]*?)\];/.exec(src);
    const detail = /const SESSION_DETAIL_COLUMNS\s*=\s*\[([\s\S]*?)\];/.exec(src);
    if (!analysis || !detail) throw new Error('could not locate the reader column lists in storage.ts — coupling broken');
    // Consume the array STRICTLY (Codex finding). A regex that harvests only the literals it recognises
    // silently drops the rest: switch one entry from single to double quotes and this returned a SUBSET,
    // the two explicit authority assertions still passed, and the reduced SELECT still succeeded — so the
    // suite would have gone on green while production selected a column it never exercised.
    const literals = (body: string, where: string): string[] => {
        const out: string[] = [];
        for (const raw of body.split(',')) {
            // Strip line comments and whitespace; a trailing empty segment is the trailing comma.
            const entry = raw.replace(/\/\/.*$/gm, '').trim();
            if (entry === '') continue;
            if (/^\.\.\.[A-Z_]+$/.test(entry)) continue;    // a spread, handled by the caller
            const quoted = /^'([a-z_]+)'$/.exec(entry);
            if (!quoted) {
                throw new Error(`unparsed column entry in ${where}: ${JSON.stringify(entry)} — this parser would have silently dropped it, so the test would exercise fewer columns than production selects`);
            }
            out.push(quoted[1]);
        }
        return out;
    };
    const inherited = /\.\.\.SESSION_ANALYSIS_COLUMNS/.test(detail[1])
        ? literals(analysis[1], 'SESSION_ANALYSIS_COLUMNS') : [];
    return [...inherited, ...literals(detail[1], 'SESSION_DETAIL_COLUMNS')];
}

/** Read the row back through the columns the PRODUCTION reader asks for — not a convenient subset. */
async function readAsReaderDoes(db: PGlite, sessionId: string) {
    const cols = readerDetailColumns();
    const r = await db.query<Record<string, unknown>>(
        `SELECT ${cols.join(', ')} FROM public.sessions WHERE id = $1`, [sessionId]);
    return r.rows[0] as { transcript?: string | null; transcript_state?: string | null };
}

/** Code points, which is what PostgreSQL `char_length` counts — NOT JS UTF-16 units. */
const codePoints = (s: string) => [...s].length;

const measure = async (db: PGlite, sessionId: string) =>
    (await db.query<{ chars: number | null; bytes: number | null }>(
        `SELECT char_length(transcript)::int AS chars, octet_length(transcript)::int AS bytes
           FROM public.sessions WHERE id = $1`, [sessionId])).rows[0];

describe('#1423 T6 — the length the client sent is the length the database holds is the length the reader renders', () => {
    it('agrees on a plain ASCII transcript across client, row and reader', async () => {
        const db = await db0();
        const s = await newSession(db);
        const sent = 'synthetic round trip transcript for the review reader';

        const receipt = await complete(db, s, { transcript: sent });
        expect(receipt.success).toBe(true);

        const m = await measure(db, s);
        expect(m.chars).toBe(codePoints(sent));

        const view = resolveTranscriptView(await readAsReaderDoes(db, s));
        expect(view.kind).toBe('available');
        if (view.kind !== 'available') throw new Error('unreachable');
        expect(view.text).toBe(sent);
        expect(codePoints(view.text)).toBe(m.chars);
    });

    it('agrees on a MULTI-BYTE transcript, where characters, UTF-16 units and bytes all differ', async () => {
        const db = await db0();
        const s = await newSession(db);
        // An astral emoji is 1 character, 2 UTF-16 units and 4 bytes; the CJK run is 1 character and 3 bytes
        // each. A truncation or re-encoding anywhere in the path moves these three numbers apart.
        const sent = `alpha \u{1F680} beta 中文 gamma`;
        expect(codePoints(sent)).not.toBe(sent.length); // the test is only meaningful if they differ

        expect((await complete(db, s, { transcript: sent })).success).toBe(true);

        const m = await measure(db, s);
        expect(m.chars).toBe(codePoints(sent));
        expect(m.bytes).toBe(Buffer.byteLength(sent, 'utf8'));
        expect(m.bytes).toBeGreaterThan(m.chars as number);

        const view = resolveTranscriptView(await readAsReaderDoes(db, s));
        if (view.kind !== 'available') throw new Error(`expected available, got ${view.kind}`);
        expect(view.text).toBe(sent);
    });

    it('stores the transcript verbatim — the row is byte-identical to what was sent', async () => {
        const db = await db0();
        const s = await newSession(db);
        // Interior structure a normaliser would be tempted to collapse.
        const sent = 'line one\nline two\r\n\ttabbed   spaced   nbsp';

        expect((await complete(db, s, { transcript: sent })).success).toBe(true);
        expect((await row(db, s)).transcript).toBe(sent);
    });

    it('between the row and the RESOLVED VIEW, the documented trim is the only transformation', async () => {
        const db = await db0();
        const s = await newSession(db);
        const core = 'synthetic body text';
        const sent = `  \n${core}\t \n `;

        expect((await complete(db, s, { transcript: sent })).success).toBe(true);
        // The row keeps every character the client sent...
        expect((await row(db, s)).transcript).toBe(sent);
        // ...and the RESOLVED VIEW differs from it by exactly the trim, never by a truncation.
        //
        // Scope, stated precisely because the earlier wording overclaimed (Codex finding): this covers the
        // row through `resolveTranscriptView`. It does NOT cover rendering. `tokensFromTranscript` drops
        // whitespace tokens and the transcript component rejoins them with single spaces, so interior runs
        // of whitespace are normalised downstream of here. That is a presentation choice, not a truncation,
        // and the assertion below is deliberately about the authority rather than the pixels.
        const view = resolveTranscriptView(await readAsReaderDoes(db, s));
        if (view.kind !== 'available') throw new Error(`expected available, got ${view.kind}`);
        expect(view.text).toBe(sent.trim());
        expect(view.text).toBe(core);
        // The words survive intact — which is the property a reader actually depends on.
        expect(view.text.split(/\s+/)).toEqual(sent.trim().split(/\s+/));
    });
});

describe('#1423 T6 — the saved receipt is the database’s statement, not the client’s hope', () => {
    it('the receipt’s transcript_state is the state the row actually carries', async () => {
        const db = await db0();
        for (const sent of ['synthetic retained text', '   ']) {
            const s = await newSession(db);
            const receipt = await complete(db, s, { transcript: sent });
            const r = await row(db, s);
            expect(receipt.transcript_state).toBe(r.transcript_state);
            expect(TRANSCRIPT_STATES as readonly string[]).toContain(r.transcript_state);
        }
    });

    it('`retained` is only ever reported over a row that genuinely holds the text', async () => {
        const db = await db0();
        const s = await newSession(db);
        const sent = 'synthetic retained body';
        const receipt = await complete(db, s, { transcript: sent });

        expect(receipt.transcript_outcome).toBe('retained');
        expect(receipt.transcript_retained).toBe(true);
        const r = await row(db, s);
        expect(r.transcript).toBe(sent);
        expect(r.transcript_state).toBe('available');
        expect(resolveTranscriptView(await readAsReaderDoes(db, s)).kind).toBe('available');
    });

    it('a blank recording is reported as not_captured by the server AND read as not_captured', async () => {
        const db = await db0();
        const s = await newSession(db);
        const receipt = await complete(db, s, { transcript: '   ' });

        expect(receipt.transcript_retained).toBe(false);
        expect(receipt.transcript_state).toBe('not_captured');
        // The honest sentence "no speech was captured" is licensed by the SERVER state, and nothing else.
        expect(resolveTranscriptView(await readAsReaderDoes(db, s)).kind).toBe('not_captured');
    });

    it('an aged-out transcript reads EXPIRED, and no text survives the sweep to be rendered', async () => {
        const db = await db0();
        const old = await newSession(db);
        expect((await complete(db, old, { transcript: 'synthetic OLD body that must age out' })).success).toBe(true);
        // Sanity: it was genuinely retained and readable before the sweep, so the assertion below is a
        // transition and not a state the row was always in.
        expect(resolveTranscriptView(await readAsReaderDoes(db, old)).kind).toBe('available');

        // A newer completion whose retention pass expires the OLDEST transcript-bearing row for this user.
        const fresh = await newSession(db);
        await db.query(`UPDATE public.retention_mode SET mode = 'expire'`);
        expect((await complete(db, fresh, { transcript: 'synthetic NEW body' })).success).toBe(true);

        const r = await row(db, old);
        expect(r.transcript_state).toBe('expired');
        expect(r.transcript).toBeNull();

        // F-05: this is the case the review reader used to render as an empty transcript.
        expect(resolveTranscriptView(await readAsReaderDoes(db, old)).kind).toBe('expired');
    });
});

describe('#1423 T6 — the reader’s select carries the authority it depends on', () => {
    it('the DETAIL columns name BOTH the text and the server state', async () => {
        const cols = readerDetailColumns();
        expect(cols).toContain('transcript');
        expect(cols).toContain('transcript_state');
    });

    it('every column the reader selects exists on the real table', async () => {
        const db = await db0();
        const s = await newSession(db);
        await complete(db, s, { transcript: 'synthetic body' });
        // Executing the parsed list is the assertion: an unknown column throws here rather than in production.
        await expect(readAsReaderDoes(db, s)).resolves.toBeTruthy();
    });

    it('a row read WITHOUT the state column cannot be rendered as a transcript', async () => {
        const db = await db0();
        const s = await newSession(db);
        const sent = 'synthetic body the legacy select would leak';
        await complete(db, s, { transcript: sent });

        // The pre-migration legacy select omits `transcript_state`. Text alone must not be promoted to
        // "available" — that inference is precisely what makes expired and failed-to-load indistinguishable.
        const legacy = await db.query<{ transcript: string | null }>(
            `SELECT transcript FROM public.sessions WHERE id = $1`, [s]);
        expect(resolveTranscriptView(legacy.rows[0]).kind).toBe('unavailable');
    });
});

describe('#1423 T6 — the database makes the leak the reader guards against unreachable', () => {
    // Mutating `resolveTranscriptView` to infer availability from text does NOT leak an aged-out transcript
    // here, and the reason matters: the sweep NULLs the column, so there is no text left to infer from. That
    // is a DATABASE guarantee, not a client one, and it is only worth relying on if it is enforced rather
    // than merely observed — so assert the constraint itself refuses the state the leak would require.
    it('refuses to store an expired row that still carries transcript text', async () => {
        const db = await db0();
        const s = await newSession(db);
        await complete(db, s, { transcript: 'synthetic body' });

        // The derivation trigger owns transcript_state, so suppressing it is the only way to attempt the
        // forbidden pair at all — which is itself the point: no client can reach this state.
        await db.exec("SET session_replication_role = 'replica'");
        await expect(db.query(
            `UPDATE public.sessions SET transcript_state = 'expired' WHERE id = $1`, [s],
        )).rejects.toThrow(/sessions_expired_transcript_null_check/);
        await db.exec("SET session_replication_role = 'origin'");

        // The row is untouched and still reads as the retained transcript it is.
        expect(resolveTranscriptView(await readAsReaderDoes(db, s)).kind).toBe('available');
    });
});

describe('#1423 T6 — the retention contract is measured, not assumed', () => {
    it('a user never accumulates more transcript-bearing rows than the sweep permits', async () => {
        const db = await db0();
        await db.query(`UPDATE public.retention_mode SET mode = 'expire'`);
        for (let i = 0; i < 4; i++) {
            const s = await newSession(db);
            expect((await complete(db, s, { transcript: `synthetic body ${i}` })).success).toBe(true);
        }
        const n = (await db.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM public.sessions
              WHERE user_id = $1 AND transcript IS NOT NULL AND transcript ~ '[^[:space:]]'`, [U])).rows[0].n;
        expect(n).toBeLessThanOrEqual(2);
    });
});

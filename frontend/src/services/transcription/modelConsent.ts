/**
 * CONSENT TO A POSSIBLE DOWNLOAD — NOT A CLAIM ABOUT THE CACHE.
 *
 * Readiness used to ask "is the model downloaded?" and answer it by probing the Transformers cache. For
 * a Moonshine selection that probe reads a DIFFERENT engine's cache: a user with v2 cached was told the
 * model was ready and then pulled ~305 MB with no prompt, while the prompt they should have seen quoted
 * v2's ~80 MB. Both halves were wrong, and both were wrong in the user's disfavour.
 *
 * The deeper problem is that "is it cached?" is a question we cannot honestly answer. The Moonshine
 * runtime fetches its own assets and exposes no probe, so any cache verdict would be invented. The two
 * available answers were therefore to lie, or to prompt on every single session.
 *
 * So the question changes. What is durable is the user's CONSENT to a possible download of a specific
 * set of bytes; what is not durable, and not observable, is whether those bytes are currently on disk.
 * A receipt records the former and asserts nothing about the latter. That is why the copy says the model
 * MAY download up to a size, and may need downloading again if browser storage is cleared — a promise we
 * can actually keep.
 *
 * Three states, kept separate, because collapsing any two is what produced the original defect:
 *   1. consent absent            — ask, quoting this candidate's real maximum
 *   2. consent present, unloaded — initialization may proceed; NOT ready, and nothing is claimed cached
 *   3. engine loaded            — only the real engine, having published a matching identity, is READY
 */
import { CANDIDATES, type Candidate, type CandidateId } from './candidateRegistry';

const STORAGE_KEY = 'ss_model_consent_v1';

export interface ConsentReceipt {
    candidateId: CandidateId;
    /** Identifies the exact asset SET consented to; a re-pin changes it and voids the receipt. */
    pinDigest: string | null;
    /** The runtime that will execute those assets. A runtime bump may change what is fetched. */
    runtimeVersion: string;
    /** The maximum quoted to the user AT THE TIME THEY AGREED. */
    maxBytes: number | null;
    grantedAt: string;
}

export interface ConsentTerms {
    candidateId: CandidateId;
    pinDigest: string | null;
    runtimeVersion: string;
    maxBytes: number | null;
}

/** ONE AUTHORITY. Terms are derived from the registry, never assembled at a call site. */
export function consentTermsFor(candidate: Candidate): ConsentTerms {
    return {
        candidateId: candidate.id,
        pinDigest: candidate.assets.pinDigest ?? null,
        runtimeVersion: candidate.runtime.version,
        maxBytes: candidate.assets.totalBytes ?? null,
    };
}

/**
 * Is this receipt still good for these terms?
 *
 * A changed candidate, pin digest or runtime version voids it: the user agreed to download a named set
 * of bytes, and those are no longer that set. An INCREASE in the maximum voids it too — consent to
 * 305 MB is not consent to 800 MB. A DECREASE does not: the user is getting less than they agreed to,
 * and re-prompting for good news trains people to click through prompts without reading them.
 */
export function receiptCovers(receipt: ConsentReceipt | null, terms: ConsentTerms): boolean {
    if (!receipt) return false;
    if (receipt.candidateId !== terms.candidateId) return false;
    if (receipt.pinDigest !== terms.pinDigest) return false;
    if (receipt.runtimeVersion !== terms.runtimeVersion) return false;
    // An unknown maximum on either side cannot be shown to be covered.
    if (terms.maxBytes === null || receipt.maxBytes === null) return terms.maxBytes === receipt.maxBytes;
    return terms.maxBytes <= receipt.maxBytes;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

const defaultStore = (): Store | null => {
    try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};

export function readReceipt(candidateId: CandidateId, store: Store | null = defaultStore()): ConsentReceipt | null {
    if (!store) return null;
    try {
        const all = JSON.parse(store.getItem(STORAGE_KEY) || '{}') as Record<string, ConsentReceipt>;
        return all[candidateId] ?? null;
    } catch {
        // Unreadable storage means we cannot show consent was given, and absence of proof of consent is
        // treated as absence of consent.
        return null;
    }
}

export class ConsentNotPersistedError extends Error {}

/**
 * Record the grant, or say plainly that it was not recorded.
 *
 * THIS USED TO SWALLOW STORAGE FAILURES and return the receipt object anyway, with a comment claiming
 * "a receipt we cannot persist simply prompts again next time". That sentence describes the repeated-
 * prompt loop this whole mechanism exists to prevent, written as though it were a design choice. An
 * unavailable store — private browsing, a quota error, blocked site data — produced a caller that
 * believed consent was durable, initialization that proceeded, a ~305 MB download, and the same question
 * again next session. Every step reporting success.
 *
 * A returned object is not evidence of persistence. The write is read back, because `setItem` can also
 * fail silently under quota pressure on some browsers, and "we called setItem" is a weaker claim than
 * "the value is there".
 */
export function recordConsent(
    terms: ConsentTerms,
    grantedAt: string,
    store: Store | null = defaultStore(),
): ConsentReceipt {
    const receipt: ConsentReceipt = { ...terms, grantedAt };
    if (!store) {
        throw new ConsentNotPersistedError(
            'STT_CONSENT_NOT_PERSISTED: no storage is available, so the decision cannot be remembered',
        );
    }
    try {
        const all = JSON.parse(store.getItem(STORAGE_KEY) || '{}') as Record<string, ConsentReceipt>;
        all[terms.candidateId] = receipt;
        store.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch (cause) {
        throw new ConsentNotPersistedError(
            `STT_CONSENT_NOT_PERSISTED: the decision could not be written (${cause instanceof Error ? cause.name : 'unknown'})`,
        );
    }
    // READ BACK. `setItem` returning without throwing is not proof the value survived, and the whole
    // point of the receipt is that a later session finds it.
    const stored = readReceipt(terms.candidateId, store);
    if (!stored || stored.grantedAt !== grantedAt) {
        throw new ConsentNotPersistedError(
            'STT_CONSENT_NOT_PERSISTED: the decision was written but could not be read back',
        );
    }
    return receipt;
}

export type ConsentDecision =
    | { state: 'consent_required'; terms: ConsentTerms; maxBytes: number | null; reason: string }
    | { state: 'may_initialize'; terms: ConsentTerms };

/**
 * Decide whether initialization may proceed. Deliberately says NOTHING about cache or readiness.
 *
 * @param reducedData the browser's explicit reduced-data signal. Where the user has said they are
 *   metered we surface the size again before a network attempt. Only an EXPLICIT signal counts —
 *   inferring network quality from timings would re-prompt people at random.
 */
export function consentDecision(
    candidate: Candidate,
    receipt: ConsentReceipt | null,
    reducedData = false,
): ConsentDecision {
    const terms = consentTermsFor(candidate);
    if (!receiptCovers(receipt, terms)) {
        return {
            state: 'consent_required',
            terms,
            maxBytes: terms.maxBytes,
            reason: receipt ? 'the approved model, asset set, runtime or size has changed' : 'no consent recorded',
        };
    }
    if (reducedData) {
        return {
            state: 'consent_required',
            terms,
            maxBytes: terms.maxBytes,
            reason: 'the browser reports reduced-data mode',
        };
    }
    return { state: 'may_initialize', terms };
}

/**
 * The words shown to the user.
 *
 * MAY download UP TO — never "will download" and never "already downloaded". We cannot see the runtime's
 * cache, so both of those would be claims we cannot support, and the storage-cleared caveat is the
 * honest consequence of not being able to see it.
 */
export function consentCopy(terms: ConsentTerms): string {
    const size = terms.maxBytes === null
        ? 'an unknown amount of data'
        : `up to ${(terms.maxBytes / 1_000_000).toFixed(0)} MB`;
    return `This model may download ${size} the first time it runs, and may need to download again `
        + 'if your browser storage is cleared. It runs entirely on your device.';
}

/**
 * Has the user EXPLICITLY told the browser they are on a metered/reduced-data connection?
 *
 * Only the explicit signal counts. Inferring "the network feels slow" from timings would re-prompt
 * people at random, and a prompt that appears for no reason the user can perceive is one they learn to
 * dismiss without reading — which costs more than it saves.
 */
export function reducedDataRequested(nav: unknown = typeof navigator === 'undefined' ? null : navigator): boolean {
    const conn = (nav as { connection?: { saveData?: unknown } } | null)?.connection;
    return conn?.saveData === true;
}

export const CONSENT_STORAGE_KEY = STORAGE_KEY;
export { CANDIDATES };

/**
 * #1432 — one-use authorization for the canonical Production comparison surface.
 *
 * PRODUCT OWNER DECISION 5651663038 / PM DECISION 5651684739 — the MVP authorization boundary is one authenticated
 * `.github/workflows/rc-gates.yml` run attempt, dispatched and triggered by the repository owner from the default
 * branch for ONE comparison cell. That run mints the one-use `comparison_nonce` bound to the release, candidate,
 * journey and evidence document. Trusted Node live-reads the run before it arms this page, and the terminal
 * validator re-reads it (`scripts/human-test/modelComparisonRunAuthority.mjs`).
 *
 * This module is DEFENSE-IN-DEPTH AND UX GATING ONLY. It runs in the page realm, so it carries no qualification
 * authority and performs no cryptography: it keeps an ordinary Production navigation from exposing the switch,
 * binds the surface to this release and origin, and spends each nonce once. It has no wall-clock expiry: the
 * authorization is one run attempt, not a time window.
 */

export const MODEL_COMPARISON_AUTH_KEY = 'speaksharp.model-comparison.authorization';
export const MODEL_COMPARISON_REPLAY_KEY = 'speaksharp.model-comparison.consumed.v1';
export const MODEL_COMPARISON_POSITIVE_CONTROL_KEY = 'speaksharp.model-comparison.positive-control.v1';
const VERSION = 'speaksharp-model-comparison-run-authorization-v1';
const CLOCK_SKEW_MS = 30_000;
const COMPARISON_CANDIDATES = new Set(['v2:base.en', 'v4:distil:q4', 'moonshine:streaming-medium']);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SESSION_BINDING_VERSION = 'speaksharp.model-comparison-session-binding.v1';

export type ModelComparisonJourney = 'open_mic' | 'focus_points';

/** The authorization artifact's page-relevant fields. Run provenance is checked in trusted Node, not here. */
interface RunAuthorization {
    schemaVersion: typeof VERSION;
    runId: number;
    releaseSha: string;
    origin: string;
    nonce: string;
    candidateId: string;
    journey: ModelComparisonJourney;
    evidenceDocumentId: string;
    issuedAt: string;
}

let armed: RunAuthorization | null = null;
let activeNonce: string | null = null;
let activeEvidenceDocumentId: string | null = null;

const validShape = (value: unknown): value is RunAuthorization => {
    if (!value || typeof value !== 'object') return false;
    const auth = value as Partial<RunAuthorization>;
    return auth.schemaVersion === VERSION
        && Number.isInteger(auth.runId) && (auth.runId as number) > 0
        && typeof auth.releaseSha === 'string' && /^[0-9a-f]{40}$/.test(auth.releaseSha)
        && typeof auth.origin === 'string'
        && typeof auth.nonce === 'string' && /^[A-Za-z0-9._:-]{16,128}$/.test(auth.nonce)
        && typeof auth.candidateId === 'string' && COMPARISON_CANDIDATES.has(auth.candidateId)
        && (auth.journey === 'open_mic' || auth.journey === 'focus_points')
        && typeof auth.evidenceDocumentId === 'string' && UUID_V4.test(auth.evidenceDocumentId)
        && typeof auth.issuedAt === 'string';
};

export function hasModelComparisonAuthorization(): boolean { return armed !== null; }

/**
 * Content-free join between the run-issued browser authorization and governed take telemetry.
 * This is deliberately the one-use TAKE nonce, never a user or database session identifier, and never
 * the document-scoped positive-control nonce (`control_nonce`, which is the evidence-document id).
 */
export function modelComparisonTakeNonce(): string | null {
    return activeNonce;
}

/** Run-authorized document identifier shared by the six rows in one down-selection packet. */
export function modelComparisonEvidenceDocumentId(): string | null {
    return activeEvidenceDocumentId;
}

/**
 * The take-specific comparison fields for `practice_mode_selected`, `session_started` and `session_saved`.
 *
 * #1432 PM Option A — the governed envelope is the SOLE authority for `journey_id`, `attempt_id`,
 * `attempt_seq` and `boot_id`, and `AnalyticsBuffer` strips any producer copy before applying it. This
 * therefore never writes those keys: the run-issued take travels as `comparison_nonce`, a separate join, and
 * the native journey/attempt identity stays independently observed. Both values are null outside an
 * authorized take.
 */
export function modelComparisonTakeTelemetry(): {
    comparison_nonce: string | null;
    comparison_evidence_document_id: string | null;
} {
    return { comparison_nonce: activeNonce, comparison_evidence_document_id: activeEvidenceDocumentId };
}

/**
 * Claim the one governed transport control for an evidence document. The document id is named by the
 * authorization run and reused across its six takes; durable denial state makes only the first successful
 * authorized switch emit. Deleting the ledger cannot mint model-switch authority.
 */
export function claimModelComparisonPositiveControl(
    root: typeof globalThis = globalThis,
): string | null {
    if (!activeEvidenceDocumentId) return null;
    try {
        const raw = root.localStorage.getItem(MODEL_COMPARISON_POSITIVE_CONTROL_KEY);
        const parsed = raw === null ? {} : JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        const ledger = parsed as Record<string, true>;
        if (ledger[activeEvidenceDocumentId] === true) return null;
        ledger[activeEvidenceDocumentId] = true;
        root.localStorage.setItem(MODEL_COMPARISON_POSITIVE_CONTROL_KEY, JSON.stringify(ledger));
        const persisted = JSON.parse(root.localStorage.getItem(MODEL_COMPARISON_POSITIVE_CONTROL_KEY) ?? 'null');
        return persisted?.[activeEvidenceDocumentId] === true ? activeEvidenceDocumentId : null;
    } catch {
        return null;
    }
}

/**
 * Privacy-safe proof that the authorized take produced one exact persisted session.
 *
 * Canonical bytes are pinned as a JSON array so browser and trusted Node readback cannot disagree
 * about separators or field order. The raw database id never enters telemetry. Privacy relies on the
 * session id being an unguessable UUIDv4; the run-issued nonce is correlation authority, not a secret.
 */
export async function modelComparisonSessionBindingSha256(
    persistedSessionId: string | null,
    root: typeof globalThis = globalThis,
): Promise<string | null> {
    if (!activeNonce || !persistedSessionId || !UUID_V4.test(persistedSessionId) || !root.crypto?.subtle) return null;
    try {
        const canonical = JSON.stringify([SESSION_BINDING_VERSION, activeNonce, persistedSessionId]);
        const digest = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
        return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch {
        // Evidence failure must HOLD the comparison row; it must never turn a saved user session into
        // an application failure or create a model-specific harness penalty.
        return null;
    }
}

type ReplayLedger = Record<string, string>;

function claimDurableNonce(payload: RunAuthorization, root: typeof globalThis): boolean {
    let storage: Storage;
    try {
        storage = root.localStorage;
        const raw = storage.getItem(MODEL_COMPARISON_REPLAY_KEY);
        const parsed = raw === null ? {} : JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
        // Spent nonces are never pruned: without an expiry, a spent nonce must stay spent. The controlled
        // protocol spends at most six per evidence document, so the ledger stays small.
        const ledger = Object.fromEntries(Object.entries(parsed as ReplayLedger).filter(([, issuedAt]) => typeof issuedAt === 'string'));
        if (Object.prototype.hasOwnProperty.call(ledger, payload.nonce)) return false;
        ledger[payload.nonce] = payload.issuedAt;
        // This ledger is denial state, not authority: deleting it cannot mint a GitHub run authorization.
        // The controlled test protocol permits one browser tab, so this also closes document reload
        // replay without inventing a server-side capability service for the release experiment.
        storage.setItem(MODEL_COMPARISON_REPLAY_KEY, JSON.stringify(ledger));
        const persisted = JSON.parse(storage.getItem(MODEL_COMPARISON_REPLAY_KEY) ?? 'null') as ReplayLedger | null;
        return persisted?.[payload.nonce] === payload.issuedAt;
    } catch {
        // Production comparison authority must survive a document/module replacement. If durable
        // same-origin storage cannot make the nonce use visible to the next document, fail closed.
        return false;
    }
}

function consumeAuthorizationNow(): boolean {
    // This function is present in the public browser chunk, so none of its inputs may come from its caller:
    // release, origin and durable replay storage come only from the running document. Tests replace those
    // platform values before calling this zero-argument boundary; they cannot pass alternate state through it.
    const root = globalThis;
    const now = Date.now();
    armed = null;
    activeNonce = null;
    activeEvidenceDocumentId = null;
    const carrier = root as unknown as Record<symbol, unknown>;
    const symbol = Symbol.for(MODEL_COMPARISON_AUTH_KEY);
    const value = carrier[symbol];
    try { delete carrier[symbol]; } catch { /* fail closed below */ }
    if (!validShape(value)) return false;

    const release = (root as typeof globalThis & { __APP_RELEASE__?: string }).__APP_RELEASE__;
    const origin = (root as typeof globalThis & { location?: Location }).location?.origin;
    if (value.releaseSha !== release || value.origin !== origin) return false;
    const issuedAt = Date.parse(value.issuedAt);
    if (!Number.isFinite(issuedAt) || issuedAt > now + CLOCK_SKEW_MS) return false;
    // Claim before exposing the surface. The module-private capability below is then usable for exactly one
    // candidate/journey switch; the durable claim keeps the nonce spent after a reload or `vi.resetModules()`.
    if (!claimDurableNonce(value, root)) return false;
    armed = value;
    return true;
}

/** Arm the comparison surface from the injected run authorization, if it is valid for this document. */
export function consumeModelComparisonAuthorization(): Promise<boolean> {
    return Promise.resolve(consumeAuthorizationNow());
}

/** Consume the armed capability at the actual switch boundary, exactly once and for its authorized row. */
export function consumeModelComparisonTakeAuthorization(
    candidateId: string,
    journey: ModelComparisonJourney | undefined,
): boolean {
    const capability = armed;
    // Any attempt spends the module-private arm. A caller cannot probe alternate rows until one fits.
    armed = null;
    if (!capability || capability.candidateId !== candidateId || capability.journey !== journey) return false;
    activeNonce = capability.nonce;
    activeEvidenceDocumentId = capability.evidenceDocumentId;
    return true;
}

/** Test-only reset; no Production caller can mint authority through it. */
export function resetModelComparisonAuthorizationForTest(): void {
    armed = null;
    activeNonce = null;
    activeEvidenceDocumentId = null;
}

/** Test-only reset of the off-module replay authority. */
export function resetModelComparisonReplayLedgerForTest(root: typeof globalThis = globalThis): void {
    try { root.localStorage.removeItem(MODEL_COMPARISON_REPLAY_KEY); } catch { /* no storage in this test */ }
    try { root.localStorage.removeItem(MODEL_COMPARISON_POSITIVE_CONTROL_KEY); } catch { /* no storage in this test */ }
}

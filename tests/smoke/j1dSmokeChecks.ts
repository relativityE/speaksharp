/**
 * J1.d reserved-namespace smoke: the pure verdicts the disposable-stack smoke and its negative controls share.
 * A disposable `speaksharp.test` account confirms its email through local Mailpit, signs out, is redirected away from a protected
 * route, and signs back into the same account and its own detail. Disposable smoke evidence only: not a production J1.d pass and
 * not proof that hosted Supabase accepts `.test`.
 */

export type SmokeVerdict = { status: 'PASS' | 'FAIL' | 'HOLD'; reason: string };

/** The reserved test namespace (RFC 2606): nobody can receive mail there, so the run reads only the local Mailpit. */
export const SMOKE_EMAIL_DOMAIN = 'speaksharp.test';

/** The run-owned identity the J1.d admission mints (`rwt-journey-open-mic-<13-digit ms>-<run>`), at the reserved namespace. */
export function smokeIdentity(nowMs: number, run: string, label = 'open-mic'): string {
    if (!/^\d{13}$/.test(String(nowMs)) || !/^(\d+|local)$/.test(run) || !/^[a-z]+(-[a-z]+)*$/.test(label)) throw new Error('smoke identity inputs are malformed');
    return `rwt-journey-${label}-${nowMs}-${run}@${SMOKE_EMAIL_DOMAIN}`;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Every target must be plain-http loopback. Anything else (a hosted project, a public URL, an unparsable value) refuses. */
export function loopbackTargets(targets: Record<string, string | undefined>): SmokeVerdict {
    for (const [name, raw] of Object.entries(targets)) {
        let url: URL;
        try { url = new URL(raw ?? ''); } catch { return { status: 'HOLD', reason: `${name}_unparsable` }; }
        if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) return { status: 'HOLD', reason: `${name}_not_loopback` };
    }
    return { status: 'PASS', reason: 'loopback_only' };
}

/** A Mailpit message summary, as `/api/v1/search` returns it (only the fields read here). */
export interface MailSummary { ID?: unknown; To?: Array<{ Address?: unknown }> }

/**
 * The single confirmation message for exactly this address. None is `unavailable` (HOLD: confirmation could not be proven);
 * more than one, or one addressed to anyone else as well, is ambiguous (HOLD). Never the content, only the id.
 */
export function confirmationMessage(messages: readonly MailSummary[] | null, address: string): { state: 'found'; id: string } | { state: 'unavailable' | 'ambiguous' } {
    if (!Array.isArray(messages)) return { state: 'unavailable' };
    const mine = messages.filter((m) => Array.isArray(m.To) && m.To.some((t: { Address?: unknown }) => String(t.Address ?? '').toLowerCase() === address.toLowerCase()));
    if (mine.length === 0) return { state: 'unavailable' };
    if (mine.length > 1 || mine[0].To!.length !== 1 || typeof mine[0].ID !== 'string' || mine[0].ID === '') return { state: 'ambiguous' };
    return { state: 'found', id: mine[0].ID };
}

/**
 * The one confirmation link in a message body: the local Auth verify endpoint on the stack's own loopback API, type signup.
 * Returned only to the caller, never logged. Anything else (no link, two links, a non-loopback host) is null.
 */
export function confirmationLink(body: string, apiUrl: string): string | null {
    const api = new URL(apiUrl);
    const links = [...new Set([...body.matchAll(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/g)].map((m) => m[0].replace(/&amp;/g, '&')))];
    if (links.length !== 1) return null;
    const link = new URL(links[0]);
    if (link.origin !== api.origin || link.searchParams.get('type') !== 'signup' || !link.searchParams.get('token')) return null;
    return link.toString();
}

/** Signed out, the protected route must land on the sign-in page with none of the protected content rendered. */
export function signedOutRedirectVerdict(o: { requested: string; landedPath: string; protectedContentVisible: boolean; ownedReadSucceeded: boolean }): SmokeVerdict {
    if (o.protectedContentVisible) return { status: 'FAIL', reason: 'protected_content_shown_signed_out' };
    if (o.ownedReadSucceeded) return { status: 'FAIL', reason: 'owned_read_succeeded_signed_out' };
    if (o.landedPath === o.requested) return { status: 'FAIL', reason: 'no_redirect' };
    if (!o.landedPath.startsWith('/auth')) return { status: 'FAIL', reason: 'redirect_not_to_sign_in' };
    return { status: 'PASS', reason: 'redirected_to_sign_in' };
}

/** The session the browser holds is exactly the account this run created (by its Auth id), and it shows that owner's detail. */
export function sameAccountVerdict(o: { createdUid: string; sessionUid: string | null; landedPath: string; requested: string; ownedDetailVisible: boolean }): SmokeVerdict {
    if (!o.sessionUid) return { status: 'FAIL', reason: 'no_session' };
    if (o.sessionUid !== o.createdUid) return { status: 'FAIL', reason: 'different_account' };
    if (o.landedPath !== o.requested) return { status: 'FAIL', reason: 'not_returned_to_requested_route' };
    if (!o.ownedDetailVisible) return { status: 'FAIL', reason: 'owned_detail_missing' };
    return { status: 'PASS', reason: 'same_account_and_owned_detail' };
}

/** Returning signed in must not open the microphone or create a recording/session. */
export function quietReturnVerdict(o: { micAcquisitions: number; sessionsBefore: number | null; sessionsAfter: number | null }): SmokeVerdict {
    if (o.sessionsBefore === null || o.sessionsAfter === null) return { status: 'HOLD', reason: 'sessions_unread' };
    if (o.micAcquisitions !== 0) return { status: 'FAIL', reason: 'microphone_opened' };
    if (o.sessionsAfter !== o.sessionsBefore) return { status: 'FAIL', reason: 'session_created' };
    return { status: 'PASS', reason: 'no_mic_no_session' };
}

/** Values that must never reach the receipt (passwords, keys, tokens, links, the address itself). */
export function receiptLeaks(receipt: string, forbidden: readonly string[]): string[] {
    return forbidden.filter((v) => v.length >= 6 && receipt.includes(v)).map((_, i) => `forbidden_value_${i}`)
        .concat(/\/auth\/v1\/verify|access_token|refresh_token|eyJ[A-Za-z0-9_-]{10,}/.test(receipt) ? ['token_or_link_shape'] : []);
}

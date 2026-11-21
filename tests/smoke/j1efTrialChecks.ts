/**
 * J1.e / J1.f on a DISPOSABLE stack: the pure verdicts their smoke uses.
 *   J1.e: a trial that ends while the session page is open shows the payment wall on that open page; a fresh sign-in after expiry
 *         meets the wall; and the server itself refuses the expired account.
 *   J1.f: an already-expired account reaches deletion from the wall; on a loopback stack the closure service refuses explicitly
 *         (no hosted deployment binding), so deletion status fails closed: nothing is offered, sent or deleted. Deletion
 *         completion stays HOLD on the app's completion-readiness wiring and the hosted completion runtime.
 * The trial expiry is SEEDED on the scratch stack only (never production). Disposable smoke evidence, not a production pass.
 */
import type { SmokeVerdict } from './j1dSmokeChecks';

/** The account the signup trigger provisioned: a marked commercial trial with a future expiry, before any seeding. */
export function provisionedTrialVerdict(profile: { commercial_trial_granted_at?: unknown; trial_expires_at?: unknown } | null, nowMs: number): SmokeVerdict {
    if (!profile) return { status: 'HOLD', reason: 'profile_unread' };
    if (typeof profile.commercial_trial_granted_at !== 'string') return { status: 'FAIL', reason: 'trial_not_marked' };
    const expires = typeof profile.trial_expires_at === 'string' ? Date.parse(profile.trial_expires_at) : Number.NaN;
    if (!Number.isFinite(expires) || expires <= nowMs) return { status: 'FAIL', reason: 'trial_not_open' };
    return { status: 'PASS', reason: 'marked_trial_provisioned' };
}

/**
 * J1.e on the OPEN page: the session page was showing (not the wall) before the deadline, the wall replaced it after, and the page
 * was never navigated (same path). A wall that was there from the start, or one that needed a navigation, does not prove it.
 */
export function openPageWallVerdict(o: { productShownBefore: boolean; wallBefore: boolean; wallAfter: boolean; productShownAfter: boolean;
    pathBefore: string; pathAfter: string; navigations: number; micAcquisitions: number }): SmokeVerdict {
    if (!o.productShownBefore || o.wallBefore) return { status: 'HOLD', reason: 'session_not_open_before_expiry' };
    if (o.navigations !== 0 || o.pathAfter !== o.pathBefore) return { status: 'FAIL', reason: 'wall_needed_a_navigation' };
    if (!o.wallAfter) return { status: 'FAIL', reason: 'no_wall_after_expiry' };
    if (o.productShownAfter) return { status: 'FAIL', reason: 'product_still_shown_after_expiry' };
    if (o.micAcquisitions !== 0) return { status: 'FAIL', reason: 'microphone_opened' };
    return { status: 'PASS', reason: 'wall_on_open_page' };
}

/** J1.e after a fresh sign-in: the product route shows the wall and nothing of the product. */
export function freshSignInWallVerdict(o: { signedIn: boolean; wallShown: boolean; productShown: boolean }): SmokeVerdict {
    if (!o.signedIn) return { status: 'HOLD', reason: 'not_signed_in' };
    if (o.productShown) return { status: 'FAIL', reason: 'product_shown_after_expiry' };
    return o.wallShown ? { status: 'PASS', reason: 'wall_after_fresh_sign_in' } : { status: 'FAIL', reason: 'no_wall_after_fresh_sign_in' };
}

export type RpcOutcome = { ok: true } | { ok: false; message: string };
export interface UsageAnswer { can_start?: unknown; trial_active?: unknown; error?: unknown }

/**
 * J1.e "the server refuses": the SAME account's guarded product read worked before expiry and is refused with payment_required
 * after it (so the refusal is the expiry, not a broken call), and the server's own usage check says trial_expired.
 */
export function serverRefusalVerdict(o: { guardedBefore: RpcOutcome | null; guardedAfter: RpcOutcome | null; usageBefore: UsageAnswer | null;
    usageAfter: UsageAnswer | null }): SmokeVerdict {
    if (!o.guardedBefore || !o.usageBefore) return { status: 'HOLD', reason: 'contrast_unread' };
    if (!o.guardedBefore.ok || o.usageBefore.can_start !== true) return { status: 'HOLD', reason: 'account_not_open_before_expiry' };
    if (!o.guardedAfter || !o.usageAfter) return { status: 'HOLD', reason: 'refusal_unread' };
    if (o.guardedAfter.ok) return { status: 'FAIL', reason: 'guarded_read_allowed_after_expiry' };
    if (!/payment_required/.test(o.guardedAfter.message)) return { status: 'FAIL', reason: 'refused_for_another_reason' };
    if (o.usageAfter.can_start !== false || o.usageAfter.error !== 'trial_expired') return { status: 'FAIL', reason: 'usage_check_not_trial_expired' };
    return { status: 'PASS', reason: 'server_refuses_expired_account' };
}

export interface ClosureAnswer { status: number; error?: unknown; outcome?: unknown }

/**
 * J1.f on a LOOPBACK stack: account-closure deliberately refuses without a hosted project and a matching deployment
 * binding (_shared/accountClosureRuntimeBinding.ts), so the wall's deletion path must end in an EXPLICIT refusal and nothing else:
 * every closure answer is the 503 account_closure_unavailable / unavailable refusal; the deletion page shows its blocked state
 * (AccountDeletionPage: an unverifiable status blocks confirmation) and offers no verification request, and never claims a link
 * was sent; no verification email reached this address; and the account (Auth user and profile) is untouched.
 * Deletion completion is not provable here, and not even on a bound hosted project: the routed page supplies no completion
 * readiness. The spec records it as HOLD readiness_wiring_and_hosted_binding_required, never PASS.
 */
export function closureRefusedVerdict(o: { answers: readonly ClosureAnswer[]; refusalShown: boolean; requestOffered: boolean; sentShown: boolean;
    mailForAddress: number | 'unread'; authUser: 'present' | 'absent' | 'unread'; profile: 'present' | 'absent' | 'unread' }): SmokeVerdict {
    if (o.mailForAddress === 'unread' || o.authUser === 'unread' || o.profile === 'unread') return { status: 'HOLD', reason: 'refusal_unread' };
    if (o.authUser === 'absent' || o.profile === 'absent') return { status: 'FAIL', reason: 'account_changed_without_binding' };
    if (o.mailForAddress > 0) return { status: 'FAIL', reason: 'verification_email_sent' };
    if (o.sentShown) return { status: 'FAIL', reason: 'verification_claimed_sent' };
    if (o.answers.length === 0) return { status: 'HOLD', reason: 'no_closure_request_observed' };
    if (o.answers.some((a) => a.status >= 200 && a.status < 300)) return { status: 'FAIL', reason: 'closure_answered_without_binding' };
    const refusal = (a: ClosureAnswer) => a.status === 503 && (a.error === 'account_closure_unavailable' || a.outcome === 'unavailable');
    if (!o.answers.every(refusal)) return { status: 'FAIL', reason: 'refused_for_another_reason' };
    if (o.requestOffered) return { status: 'FAIL', reason: 'request_offered_after_refusal' };
    return o.refusalShown ? { status: 'PASS', reason: 'deletion_status_fails_closed' } : { status: 'FAIL', reason: 'refusal_not_shown' };
}

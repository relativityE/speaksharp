/**
 * J1.f / J7.d on the disposable billing local stack: the pure parts of the two deletion journeys
 * (account-deletion.billing.spec.ts). Each journey records FACTS only, read before any fallback cleanup; scoring is separate
 * (deletionReceipt.mjs). A fallback cleanup never earns a pass: it is recorded, and a leg that needed it is not a deletion.
 */

export type DeletionLeg = 'J1.f' | 'J7.d';
/** J1.f enters from the expired trial's wall; J7.d from the Account page. */
export const ENTRY_ROUTE: Readonly<Record<DeletionLeg, 'trial_wall' | 'account_page'>> = Object.freeze({ 'J1.f': 'trial_wall', 'J7.d': 'account_page' });

/**
 * The one deletion verification link in the email: the local Auth verify endpoint on the stack's own API origin, a magic link,
 * redirecting to this app's /account/delete with its account_deletion_token. Returned only to the caller, never logged.
 * Anything else (no link, two links, another host, another redirect) is null.
 */
export function deletionLink(body: string, apiUrl: string, appUrl: string): string | null {
    const api = new URL(apiUrl); const app = new URL(appUrl);
    const links = [...new Set([...body.matchAll(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/g)].map((m) => m[0].replace(/&amp;/g, '&')))];
    if (links.length !== 1) return null;
    let link: URL; let redirect: URL;
    try { link = new URL(links[0]); redirect = new URL(link.searchParams.get('redirect_to') ?? ''); } catch { return null; }
    if (link.origin !== api.origin || link.searchParams.get('type') !== 'magiclink' || !link.searchParams.get('token')) return null;
    if (redirect.origin !== app.origin || redirect.pathname !== '/account/delete' || !redirect.searchParams.get('account_deletion_token')) return null;
    return link.toString();
}

export type TerminalMessage = 'deleted' | 'deleted_cleanup_unverified' | 'pending' | 'refused' | 'unverified' | 'none';
/**
 * The deletion page's own final message (AccountDeletionPage.tsx). Only "Your account has been deleted." is `deleted`; the
 * page's "deleted, but complete cleanup could not be verified" is its own class and never counts as a clean deletion.
 */
export function terminalMessage(texts: readonly string[]): TerminalMessage {
    const all = texts.join('\n');
    if (/Your account was deleted, but complete cleanup could not be verified/.test(all)) return 'deleted_cleanup_unverified';
    if (/Your account has been deleted\./.test(all)) return 'deleted';
    if (/We could not verify the deletion result|Account deletion could not be verified/.test(all)) return 'unverified';
    // Pending first: the page's pending notice also says "has not been deleted", and pending is the normal step before completion.
    if (/deletion request is (still )?pending/i.test(all)) return 'pending';
    if (/Verification was refused or expired|has not been deleted/.test(all)) return 'refused';
    return 'none';
}

/** Facts one leg records before teardown. Content-free: hashes and fixed words, never an address, id, token or link. */
export interface DeletionLegFacts {
    leg: DeletionLeg;
    route: 'trial_wall' | 'account_page';
    accountSha: string;
    entryReached: boolean;
    verificationRequested: boolean;
    verificationLinkFound: boolean;
    terminal: TerminalMessage;
    /** account_closure_attempts.phase for this user, read with the stack's service key, or null when no row. */
    closurePhase: string | null;
    authUser: 'absent' | 'present' | 'unread';
    /** public.verify_account_closure_residue(uid, email): the shipped residue check. */
    residueClear: boolean | null;
    /** Only after every read above: whether the leg needed the fallback cleanup (then it is not a deletion). */
    fallbackCleanup: 'not_run' | 'ran_deleted' | 'ran_residue' | 'ran_failed';
}

/** The receipt one leg writes before teardown; the scorer combines it with the stack's teardown and destruction proof. */
export function legReceipt(facts: DeletionLegFacts, run: { release: string; stackRun: string; startedAt: number; finishedAt: number }) {
    return { kind: 'account-deletion-local-stack-leg', disposable: true, productionAcceptance: false, release: run.release, stackRun: run.stackRun,
        ...facts, durationMs: run.finishedAt - run.startedAt };
}

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

/** How often the journey re-checks status while the deletion is pending (the page never polls on its own). */
export const STATUS_RECHECK_MS = 10_000;
export type DeletionLoopStep = 'stop' | 'complete' | 'check_status' | 'wait';
/**
 * One step of the post-confirmation loop, as a user would act. A confirmation answered `pending` only shows the pending
 * notice: the page starts completion (secured status, then the server's readiness decision) when the user presses
 * "Check deletion status". So the journey presses it (at most every STATUS_RECHECK_MS), completes when the page offers
 * it, and stops on the page's final message.
 */
export function deletionLoopStep(s: { terminal: TerminalMessage; completeVisible: boolean; statusButtonVisible: boolean; msSinceStatusCheck: number }): DeletionLoopStep {
    if (s.terminal === 'deleted' || s.terminal === 'deleted_cleanup_unverified' || s.terminal === 'refused' || s.terminal === 'unverified') return 'stop';
    if (s.completeVisible) return 'complete';
    if (s.statusButtonVisible && s.msSinceStatusCheck >= STATUS_RECHECK_MS) return 'check_status';
    return 'wait';
}

/**
 * The expected result after deletion is the retention promise the product already makes, unchanged: the deletion page's own
 * notice (frontend/src/pages/AccountDeletionPage.tsx) says "Your practice data and preferences will be removed." and "Your
 * trial email is retained to prevent repeat trials. Historical billing and support records may remain." So, per record type
 * still tied to the deleted user (accountDeletionLocalStack.mjs retainedDataSql):
 *   - the Auth user and the account's owned storage: removed (0), else a violation;
 *   - the trial email: exactly one row for the address and no longer linked to the user ("retained"), else a violation;
 *   - historical billing and support records: may remain, as the exact record types in `mayRemain` only;
 *   - anything else: removed (0). A record type the policy does not name that still holds rows is a GAP between code and
 *     policy. It is reported by type and count, never "fixed" here by widening this list or changing the code.
 */
export const RETENTION_POLICY = Object.freeze({
    source: 'frontend/src/pages/AccountDeletionPage.tsx retention notice',
    removedToZero: Object.freeze(['auth.users.id', 'storage.owned.objects']),
    trialEmail: 'public.trial_entitlements.email',
    trialEmailUnlinked: 'public.trial_entitlements.email_unlinked',
    /**
     * "Historical billing and support records may remain", as EXACT record types, never a name pattern (Sam on 999d88d2: a new
     * or operational table must not pass on its name). Support reports are user-keyed; billing history is keyed by Stripe
     * customer, not by user, so no user-keyed billing type is policy-backed today. Anything else that remains is a GAP.
     */
    mayRemain: Object.freeze(['public.user_issue_reports.user_id']),
});
export type RetainedVerdict = 'removed' | 'retained_allowed' | 'violation' | 'gap';
/** One record type: its schema.table.column name, row count, how many of those rows carry any email (each row once), and a verdict. */
export interface RetainedRecord { type: string; count: number; withEmail: number; verdict: RetainedVerdict }
/** PASS: only what the policy allows remains. GAP: a type the policy does not name remains. FAIL: a promise is broken. */
export interface RetainedData { verdict: 'PASS' | 'GAP' | 'FAIL' | 'UNREAD'; records: RetainedRecord[] }

const RETAINED_LINE = /^([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\|(\d{1,9})\|(\d{1,9})$/;
/**
 * Judges retainedDataSql's output against RETENTION_POLICY. Any line that is not `type|count|withEmail`, a repeated type, or a
 * missing fixed type makes the whole read UNREAD (never a pass).
 */
export function classifyRetainedData(output: string): RetainedData {
    const unread: RetainedData = { verdict: 'UNREAD', records: [] };
    const rows = output.split('\n').map((l) => l.trim()).filter(Boolean);
    const seen = new Map<string, { count: number; withEmail: number }>();
    for (const row of rows) {
        const m = RETAINED_LINE.exec(row);
        if (!m || seen.has(m[1])) return unread;
        seen.set(m[1], { count: Number(m[2]), withEmail: Number(m[3]) });
    }
    const fixed = [...RETENTION_POLICY.removedToZero, RETENTION_POLICY.trialEmail, RETENTION_POLICY.trialEmailUnlinked];
    if (fixed.some((t) => !seen.has(t))) return unread;
    const trial = seen.get(RETENTION_POLICY.trialEmail)!; const unlinked = seen.get(RETENTION_POLICY.trialEmailUnlinked)!;
    const trialKept = trial.count === 1 && unlinked.count === 1;
    const records = [...seen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([type, { count, withEmail }]): RetainedRecord => {
        let verdict: RetainedVerdict;
        if (type === RETENTION_POLICY.trialEmail || type === RETENTION_POLICY.trialEmailUnlinked) verdict = trialKept ? 'retained_allowed' : 'violation';
        else if (count === 0) verdict = 'removed';
        else if ((RETENTION_POLICY.removedToZero as readonly string[]).includes(type)) verdict = 'violation';
        else if ((RETENTION_POLICY.mayRemain as readonly string[]).includes(type)) verdict = 'retained_allowed';
        else verdict = 'gap';
        return { type, count, withEmail, verdict };
    });
    const verdict = records.some((r) => r.verdict === 'violation') ? 'FAIL' : records.some((r) => r.verdict === 'gap') ? 'GAP' : 'PASS';
    return { verdict, records };
}
/** The record types that are a gap between code and policy, for the report (type names only). */
export const retainedGaps = (data: RetainedData | null): string[] => (data?.records ?? []).filter((r) => r.verdict === 'gap').map((r) => r.type);

export type SignInOutcome = 'refused' | 'accepted' | 'unread';
/**
 * A password sign-in after deletion. A session is `accepted`. Only Auth's own refusal of the credentials (HTTP 400,
 * invalid_credentials) is `refused`; a network failure, rate limit or anything else proves nothing and is `unread`.
 */
export function signInOutcome(r: { session: unknown; error: { status?: number | null; code?: string | null; message?: string | null } | null }): SignInOutcome {
    if (r.session) return 'accepted';
    const e = r.error;
    if (e && e.status === 400 && (e.code === 'invalid_credentials' || /^Invalid login credentials$/i.test(e.message ?? ''))) return 'refused';
    return 'unread';
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
    /** Every record type still tied to the deleted user, judged against RETENTION_POLICY; null when not read. */
    retainedData: RetainedData | null;
    /** A real password sign-in with the account's own credentials, after deletion: it must be refused. */
    signInAfterDeletion: SignInOutcome;
    /** Only after every read above: whether the leg needed the fallback cleanup (then it is not a deletion). */
    fallbackCleanup: 'not_run' | 'ran_deleted' | 'ran_residue' | 'ran_failed';
}

/** The receipt one leg writes before teardown; the scorer combines it with the stack's teardown and destruction proof. */
export function legReceipt(facts: DeletionLegFacts, run: { release: string; stackRun: string; startedAt: number; finishedAt: number }) {
    return { kind: 'account-deletion-local-stack-leg', disposable: true, productionAcceptance: false, release: run.release, stackRun: run.stackRun,
        ...facts, durationMs: run.finishedAt - run.startedAt };
}

/**
 * The scorer's per-account record (deletionReceipt.mjs DELETION_ACCOUNT_KEYS). `accountRef` is the sha256 of the run's user id,
 * so the two legs can be told apart without the id. Any fallback cleanup is recorded as such and can never pass.
 */
export function scorerAccount(facts: DeletionLegFacts, accountRefSha256: string) {
    if (!/^[0-9a-f]{64}$/.test(accountRefSha256)) throw new Error('account ref must be a sha256');
    return { accountRef: accountRefSha256, authUserAbsent: facts.authUser === 'absent', closurePhase: facts.closurePhase,
        entryReached: facts.entryReached, fallbackCleanup: facts.fallbackCleanup === 'not_run' ? 'NOT_RUN' : 'RAN', leg: facts.leg,
        residueVerified: facts.residueClear === true, retainedData: facts.retainedData?.verdict ?? 'UNREAD', retainedGaps: retainedGaps(facts.retainedData),
        route: facts.route, signInRefused: facts.signInAfterDeletion === 'refused', terminalUi: facts.terminal,
        // The one deletion link arrived for this address and the leg opened it (the page then reached its terminal step).
        verificationObserved: facts.verificationRequested && facts.verificationLinkFound };
}

/** The scorer's combined receipt for the run (deletionReceipt.mjs DELETION_RECEIPT_KEYS), written before teardown. */
export function combinedDeletionReceipt(accounts: ReadonlyArray<ReturnType<typeof scorerAccount>>, run: { release: string; stackRun: string }) {
    return { accounts: [...accounts], schema: 'account-deletion-local/v2', stackRun: run.stackRun, stripeMode: 'test', testedRelease: run.release };
}

/**
 * Each leg writes its own scorer record to a file (Sam on run 45407419238: each route runs on its own). A failed leg restarts
 * Playwright's worker, which loses any in-memory list, so the combined receipt is rebuilt from these files: only this run's
 * (release and stack run), in leg order. A duplicate leg is kept, so the scorer's account count fails it, never hides it.
 */
export function legScorerFile(account: ReturnType<typeof scorerAccount>, run: { release: string; stackRun: string }) {
    return { kind: 'account-deletion-leg-scorer', release: run.release, stackRun: run.stackRun, account };
}
export function combineLegScorerFiles(files: readonly unknown[], run: { release: string; stackRun: string }): Array<ReturnType<typeof scorerAccount>> {
    const order: Record<string, number> = { 'J1.f': 0, 'J7.d': 1 };
    return files
        .filter((f): f is ReturnType<typeof legScorerFile> => !!f && typeof f === 'object'
            && (f as { kind?: unknown }).kind === 'account-deletion-leg-scorer'
            && (f as { release?: unknown }).release === run.release && (f as { stackRun?: unknown }).stackRun === run.stackRun
            && typeof (f as { account?: { leg?: unknown } }).account?.leg === 'string')
        .map((f) => f.account)
        .sort((a, b) => (order[a.leg] ?? 9) - (order[b.leg] ?? 9));
}

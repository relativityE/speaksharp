import { withDeadline } from './rwtMainThreadTrace';

/**
 * #1258 (PM 5944997435) — content-free diagnostics for the two RWT steps run 36955422629 could not classify.
 *
 * Share Feedback showed no acknowledgement and stored nothing; "Practice this again" on the saved review did not
 * open the session page. Each has several product branches that end the same way on the receipt. These reads say
 * WHICH branch the page was in, using only closed enums and booleans: never text the person wrote, never an id,
 * never a full URL.
 *
 * Every read runs inside ONE outer deadline (the deployed-live config sets no action timeout, so a stalled renderer
 * can leave a parameterless locator call pending forever — the #1550 lesson). A read that times out is `null`, and
 * `timedOut` says so; it never consumes the test's own timeout.
 */

/** The slice of a Playwright `Page` these reads use — stubbable in unit tests. */
export interface DiagnosticPage {
    url(): string;
    getByTestId(id: string): DiagnosticLocator;
}
interface DiagnosticLocator {
    getByRole(role: 'alert'): DiagnosticLocator;
    isVisible(): Promise<boolean>;
    isEnabled(o: { timeout: number }): Promise<boolean>;
    getAttribute(name: string, o: { timeout: number }): Promise<string | null>;
    innerText(o: { timeout: number }): Promise<string>;
    count(): Promise<number>;
    first(): DiagnosticLocator;
}

export type FeedbackUiState = {
    /** The dialog's own failure line ("That didn't go through. Try again?") is showing inside the dialog. */
    errorShown: boolean | null;
    dialogOpen: boolean | null;
    submitEnabled: boolean | null;
    /** The feedback kind the test pressed is selected (`aria-checked`). */
    kindChosen: boolean | null;
    timedOut: boolean;
};

const FEEDBACK_FAILED = /didn.t go through/i;

export async function readFeedbackUiState(
    page: DiagnosticPage, o: { boundMs: number; readTimeoutMs: number; kindTestId: string },
): Promise<FeedbackUiState> {
    const outcome = await withDeadline(async (): Promise<Omit<FeedbackUiState, 'timedOut'>> => {
        const dialog = page.getByTestId('issue-report-dialog');
        const dialogOpen = await dialog.isVisible().catch(() => null);
        // Scoped to the dialog: another alert on the page must not read as the dialog's own failure line.
        const alert = dialog.getByRole('alert').first();
        const errorShown = (await alert.isVisible().catch(() => false))
            ? FEEDBACK_FAILED.test(await alert.innerText({ timeout: o.readTimeoutMs }).catch(() => ''))
            : false;
        const submitEnabled = dialogOpen
            ? await page.getByTestId('issue-report-submit').isEnabled({ timeout: o.readTimeoutMs }).catch(() => null)
            : null;
        const checked = dialogOpen
            ? await page.getByTestId(o.kindTestId).getAttribute('aria-checked', { timeout: o.readTimeoutMs }).catch(() => null)
            : null;
        return { errorShown, dialogOpen, submitEnabled, kindChosen: checked === null ? null : checked === 'true' };
    }, o.boundMs);
    if (outcome.kind === 'ok') return { ...outcome.value, timedOut: false };
    return { errorShown: null, dialogOpen: null, submitEnabled: null, kindChosen: null, timedOut: outcome.kind === 'timeout' };
}

/** The route class only — never the path itself (it carries session ids). */
export type RouteClass = 'session' | 'practice' | 'analytics_detail' | 'analytics' | 'other';
export function routeClass(url: string): RouteClass {
    let pathname = '';
    try { pathname = new URL(url).pathname.replace(/\/+$/, ''); } catch { return 'other'; }
    if (pathname === '/session') return 'session';
    if (pathname === '/practice') return 'practice';
    if (/^\/analytics\/[^/]+$/.test(pathname)) return 'analytics_detail';
    if (pathname === '/analytics') return 'analytics';
    return 'other';
}

/** `useLinkedRepeat`'s closed `LinkState`, plus `absent` (no attribute / no button) and `other` (an unknown value). */
export type PracticeLinkState = 'pending' | 'error' | 'blocked' | 'linked' | 'direct' | 'absent' | 'other';
/** Which label the one practice action carries — each names a different click branch in SavedPracticeLoopReview. */
export type PracticeLabel = 'practice_again' | 'try_again' | 'linking' | 'checking' | 'absent' | 'other';

export type PracticeActionState = {
    route: RouteClass;
    linkState: PracticeLinkState | null;
    label: PracticeLabel | null;
    enabled: boolean | null;
    timedOut: boolean;
};

const LINK_STATES: ReadonlySet<string> = new Set(['pending', 'error', 'blocked', 'linked', 'direct']);
function labelClass(text: string): PracticeLabel {
    const t = text.trim();
    if (/^Practice this again$/i.test(t)) return 'practice_again';
    if (/^Try again$/i.test(t)) return 'try_again';
    if (/^Linking repeat/i.test(t)) return 'linking';
    if (/^Checking your next practice/i.test(t)) return 'checking';
    return 'other';
}

export async function readPracticeActionState(
    page: DiagnosticPage, o: { boundMs: number; readTimeoutMs: number },
): Promise<PracticeActionState> {
    const route = routeClass(page.url());
    const outcome = await withDeadline(async (): Promise<Omit<PracticeActionState, 'route' | 'timedOut'>> => {
        const action = page.getByTestId('saved-review-practice');
        if ((await action.count()) === 0) return { linkState: 'absent', label: 'absent', enabled: null };
        const raw = await action.getAttribute('data-link-state', { timeout: o.readTimeoutMs }).catch(() => null);
        const linkState: PracticeLinkState = raw === null ? 'absent' : LINK_STATES.has(raw) ? raw as PracticeLinkState : 'other';
        const label = labelClass(await action.innerText({ timeout: o.readTimeoutMs }).catch(() => ''));
        const enabled = await action.isEnabled({ timeout: o.readTimeoutMs }).catch(() => null);
        return { linkState, label, enabled };
    }, o.boundMs);
    if (outcome.kind === 'ok') return { route, ...outcome.value, timedOut: false };
    return { route, linkState: null, label: null, enabled: null, timedOut: outcome.kind === 'timeout' };
}

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useUsageLimit } from '@/hooks/useUsageLimit';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { useSessionStore } from '@/stores/useSessionStore';
import { Button } from '@/components/ui/button';
import { arePaymentsEnabled } from '@/config/appRuntimeConfig';
import { ENV } from '@/config/TestFlags';

/**
 * Account surfaces an expired, unpaid account can still reach from the payment wall. Each route listed here
 * must stay OUTSIDE TrialServiceBoundary in App.tsx. If the PO allows a data export before deletion, add its
 * route here and leave that route outside the boundary; nothing else on the wall changes.
 */
const PAYMENT_WALL_ACCOUNT_LINKS: ReadonlyArray<{ to: string; label: string }> = Object.freeze([
    { to: '/account', label: 'Manage billing' },
    { to: '/account/delete', label: 'Delete account' },
]);

/** The longest a confirmed trial page goes without asking the server again. */
const RECHECK_MS = 60_000;

/**
 * PO 2026-11-14: "no usage after 1st month if no payment". Wraps every product and saved-work route.
 *
 * UI boundary only: the database must independently enforce product access. Never use the profile's legacy
 * trial timestamp, the URL, or checkout return parameters as proof of payment.
 *
 * - Only a fresh server permit (`can_start === true`, fetched after this mount, no error) opens it.
 * - Any other successful server answer, or the server-relative trial deadline, closes it. The deadline is held
 *   on a monotonic clock from the answer that set it, so a failed or blocked revalidation cannot extend it.
 * - A failed or in-flight revalidation alone never tears down a page that was already confirmed; it is retried.
 * - With `allowTakeToFinish` (the recording route only), a recording that was already live while access was
 *   confirmed is left to finish after expiry; the wall shows as soon as it ends, and the server refuses its save.
 */
export function TrialServiceBoundary({ children, allowTakeToFinish = false }: { children: ReactNode; allowTakeToFinish?: boolean }) {
    const { user } = useAuthProvider();
    const access = useUsageLimit();
    const { data, dataUpdatedAt, errorUpdatedAt, refetch } = access;
    const [expiredAnswer, setExpiredAnswer] = useState<number | null>(null);
    const deadline = useRef<{ answer: number; at: number | null } | null>(null);
    const confirmedFor = useRef<string | null>(null);
    const takeStartedConfirmed = useRef(false);
    // A take is live from RECORDING through STOPPING, so its stop and save outcome stays visible on the page.
    const takeLive = useSessionStore(s => s.runtimeState === 'RECORDING' || s.runtimeState === 'STOPPING');
    const expiryRefetchedFor = useRef<number | null>(null);

    useEffect(() => {
        if (data?.can_start !== true || data.trial_active !== true) return;
        if (deadline.current?.answer !== dataUpdatedAt) {
            const seconds = data.trial_seconds_remaining;
            // A missing value is not an expiry: the server's can_start stays the authority and is asked again below.
            const known = typeof seconds === 'number' && Number.isFinite(seconds);
            deadline.current = { answer: dataUpdatedAt, at: known ? performance.now() + Math.max(0, seconds) * 1000 : null };
        }
        const { at } = deadline.current;
        const remaining = at === null ? Infinity : at - performance.now();
        if (remaining <= 0) {
            setExpiredAnswer(dataUpdatedAt);
            // Ask once per expired answer. A failed attempt changes errorUpdatedAt and reruns this effect, so an
            // unconditional refetch here would loop while the server is unreachable; the wall's retry button stays.
            if (expiryRefetchedFor.current !== dataUpdatedAt) {
                expiryRefetchedFor.current = dataUpdatedAt;
                void refetch();
            }
            return;
        }
        const timers: number[] = [];
        if (Number.isFinite(remaining)) {
            timers.push(window.setTimeout(() => {
                setExpiredAnswer(dataUpdatedAt);
                expiryRefetchedFor.current = dataUpdatedAt;
                void refetch();
            }, remaining));
        }
        // Re-armed after every failed attempt too (errorUpdatedAt), so one failure never stops the checks.
        if (remaining > RECHECK_MS) timers.push(window.setTimeout(() => { void refetch(); }, RECHECK_MS));
        return () => timers.forEach(t => window.clearTimeout(t));
    }, [data, dataUpdatedAt, errorUpdatedAt, refetch]);

    // Mirrors ProtectedRoute's E2E-only no-session probe path (ENV.isE2E is false in production builds).
    // With no session there is no entitlement question to ask; the server still refuses every product call.
    if (!user && ENV.isE2E) return <>{children}</>;

    const userId = user?.id ?? null;
    const deadlinePassed = expiredAnswer !== null && expiredAnswer === access.dataUpdatedAt;
    const permitted = access.data?.can_start === true && !deadlinePassed;
    const freshPermit = permitted && access.isFetchedAfterMount && !access.error;
    // Any successful answer that is not a permit is a refusal, as is the deadline reached on this page.
    const refused = (access.data != null && access.data.can_start !== true) || deadlinePassed;
    if (confirmedFor.current !== userId) {
        confirmedFor.current = null;
        takeStartedConfirmed.current = false;
    }
    if (freshPermit) confirmedFor.current = userId;
    const confirmed = confirmedFor.current !== null && confirmedFor.current === userId;

    if (!takeLive) takeStartedConfirmed.current = false;
    else if (confirmed && !refused) takeStartedConfirmed.current = true;

    if (freshPermit || (confirmed && !refused)) return <>{children}</>;
    if (allowTakeToFinish && confirmed && takeLive && takeStartedConfirmed.current) return <>{children}</>;

    const expired = deadlinePassed || (refused && access.data?.error === 'trial_expired');
    const checking = access.isPending || access.isFetching;
    if (!refused && checking) {
        return (
            <div className="flex h-[50vh] w-full items-center justify-center" data-testid="trial-access-checking"
                role="status" aria-label="Checking your access">
                <Loader2 className="h-8 w-8 animate-spin text-signature-text" />
            </div>
        );
    }
    return (
        <main className="mx-auto max-w-xl px-6 pb-16 pt-28" data-testid="trial-payment-wall">
            <h1 className="text-2xl font-bold">
                {expired ? 'Your free trial has ended' : 'We could not confirm your access'}
            </h1>
            <p className="mt-4">
                {expired
                    ? 'Payment is required to use SpeakSharp or view your saved work. Your account stays inactive until payment is confirmed. You can still delete your account.'
                    : 'Try again, or manage or delete your account below. Your saved work is not loaded until access is confirmed.'}
            </p>
            {expired && !arePaymentsEnabled() && (
                <p className="mt-4">Paid continuation is not open yet. Your account will remain inactive; no payment can be taken here.</p>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
                {expired && <Button asChild><Link to="/pricing">View payment options</Link></Button>}
                <Button variant="outline" disabled={checking} onClick={() => { void access.refetch(); }}>
                    {checking ? 'Checking access…' : 'Check payment / retry'}
                </Button>
                {PAYMENT_WALL_ACCOUNT_LINKS.map(link => (
                    <Button key={link.to} asChild variant={link.to === '/account/delete' ? 'ghost' : 'outline'}>
                        <Link to={link.to}>{link.label}</Link>
                    </Button>
                ))}
            </div>
        </main>
    );
}

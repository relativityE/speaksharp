import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useUsageLimit } from '@/hooks/useUsageLimit';
import { Button } from '@/components/ui/button';
import { arePaymentsEnabled } from '@/config/appRuntimeConfig';

/**
 * UI boundary only: the database must independently enforce product access.
 * Never use the profile's legacy trial timestamp, the URL, or checkout return
 * parameters as proof of payment. Only a fresh server entitlement answer opens it.
 */
export function TrialServiceBoundary({ children }: { children: ReactNode }) {
    const access = useUsageLimit();
    const { data, dataUpdatedAt, refetch } = access;
    const [expiredAnswer, setExpiredAnswer] = useState<number | null>(null);

    useEffect(() => {
        if (!data?.trial_active || data.can_start !== true) return;
        const seconds = data.trial_seconds_remaining;
        if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
            setExpiredAnswer(dataUpdatedAt);
            return;
        }
        // Server-relative duration, not a comparison with the editable device clock.
        // Cap the interval to revalidate long trials without overflowing setTimeout.
        const timer = window.setTimeout(() => {
            if (seconds <= 60) setExpiredAnswer(dataUpdatedAt);
            void refetch();
        }, Math.min(seconds * 1000, 60_000));
        return () => window.clearTimeout(timer);
    }, [data, dataUpdatedAt, refetch]);

    const confirmed = access.isFetchedAfterMount && access.data?.can_start === true && !access.error
        && expiredAnswer !== access.dataUpdatedAt;
    if (confirmed) return <>{children}</>;

    const expired = access.data?.can_start === false && access.data.error === 'trial_expired';
    const checking = access.isPending || access.isFetching;
    return (
        <main className="mx-auto max-w-xl px-6 pb-16 pt-28" data-testid="trial-payment-wall">
            <h1 className="text-2xl font-bold">
                {expired ? 'Your free trial has ended' : 'Checking your access'}
            </h1>
            <p className="mt-4">
                {expired
                    ? 'Payment is required to use SpeakSharp or view your saved work. Your account stays inactive until payment is confirmed. You can still delete your account.'
                    : checking
                        ? 'Please wait while we confirm access. Your saved work is not loaded until access is confirmed.'
                        : 'We could not confirm access. Try again, or manage or delete your account below.'}
            </p>
            {expired && !arePaymentsEnabled() && (
                <p className="mt-4">Paid continuation is not open yet. Your account will remain inactive; no payment can be taken here.</p>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
                {expired && <Button asChild><Link to="/pricing">View payment options</Link></Button>}
                <Button variant="outline" disabled={checking} onClick={() => { void access.refetch(); }}>
                    {checking ? 'Checking access…' : 'Check payment / retry'}
                </Button>
                <Button asChild variant="outline"><Link to="/account">Manage billing</Link></Button>
                <Button asChild variant="ghost"><Link to="/account/delete">Delete account</Link></Button>
            </div>
        </main>
    );
}

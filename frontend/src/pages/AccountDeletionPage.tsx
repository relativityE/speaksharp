import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { accountDeletionToken, consumeAccountDeletionToken } from '@/services/accountDeletionVerification';
import { accountDeletionAttempts } from '@/services/accountDeletionAttempts';
import { Button } from '@/components/ui/button';

interface DeletionResponse {
  outcome?: 'email_requested' | 'deleted' | 'refused' | 'incomplete' | 'verification_pending';
  accountDeleted?: boolean | null;
  billingClosed?: boolean;
  customerDeleted?: boolean;
}

function closureResponse(value: unknown, action: 'request' | 'confirm'): DeletionResponse | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (action === 'request') return row.outcome === 'email_requested' ? { outcome: 'email_requested' } : null;
  if (!['deleted', 'refused', 'incomplete', 'verification_pending'].includes(String(row.outcome))
    || (row.accountDeleted !== null && typeof row.accountDeleted !== 'boolean') || typeof row.billingClosed !== 'boolean'
    || typeof row.customerDeleted !== 'boolean') return null;
  if (row.outcome === 'deleted' && (row.accountDeleted !== true || row.billingClosed !== true)) return null;
  if ((row.accountDeleted === null) !== (row.outcome === 'verification_pending')) return null;
  // The backend cannot reach customer/Auth deletion before billing is closed,
  // and verification refusal occurs before any destructive stage.
  if ((row.outcome === 'refused' && (row.accountDeleted !== false || row.billingClosed !== false || row.customerDeleted !== false))
    || ((row.accountDeleted !== false || row.customerDeleted === true) && row.billingClosed !== true)) return null;
  return row as unknown as DeletionResponse;
}

export default function AccountDeletionPage() {
  const { user, loading, signOut } = useAuthProvider();
  const token = accountDeletionToken();
  const [acknowledgement, setAcknowledgement] = useState<{ ownerId: string; checked: boolean } | null>(null);
  const [email, setEmail] = useState<{ ownerId: string; busy: boolean; message: string | null } | null>(null);
  const [completion, setCompletion] = useState<{ ownerId: string; message: string } | null>(null);
  const attempt = useSyncExternalStore(accountDeletionAttempts.subscribe,
    () => accountDeletionAttempts.snapshot(user?.id ?? null));
  const currentEmail = email?.ownerId === user?.id ? email : null;
  const currentCompletion = completion && (!user || completion.ownerId === user.id) ? completion : null;
  const confirmed = !!user && acknowledgement?.ownerId === user.id && acknowledgement.checked;
  const busy = !!currentEmail?.busy || attempt.phase === 'pending';
  const completed = !!currentCompletion || attempt.phase === 'completed';
  const confirmationBlocked = attempt.phase === 'pending' || attempt.phase === 'reconciliation';
  const message = currentCompletion?.message
    ?? (attempt.phase === 'ready' && currentEmail ? currentEmail.message : attempt.message);
  const inFlight = useRef(false);
  const operationEpoch = useRef(0);
  useLayoutEffect(() => {
    operationEpoch.current += 1;
    setAcknowledgement(null);
    setEmail(null);
    return () => { operationEpoch.current += 1; };
  }, [user?.id]);

  const submit = async (action: 'request' | 'confirm') => {
    if (inFlight.current || !user || accountDeletionAttempts.snapshot(user.id).phase !== 'ready'
      || (action === 'confirm' && (!token || !confirmed))) return;
    const ownerId = user.id;
    let confirmationId: symbol | null = null;
    if (action === 'confirm') {
      if (!token || !consumeAccountDeletionToken(token)) return;
      confirmationId = accountDeletionAttempts.begin(ownerId);
      if (!confirmationId) return;
      setAcknowledgement(null);
    }
    const submittingEpoch = ++operationEpoch.current;
    inFlight.current = true;
    setEmail(action === 'request' ? { ownerId, busy: true, message: null } : null);
    try {
      const client = getSupabaseClient();
      if (!client) throw new Error('Unavailable');
      const { data, error } = await client.functions.invoke('account-closure', {
        body: action === 'request' ? { action } : { action, token, confirmIrreversible: true },
      });
      let result = closureResponse(data, action);
      if (!result && error && typeof error === 'object' && 'context' in error
        && error.context instanceof Response) {
        try { result = closureResponse(await error.context.json(), action); } catch { /* bounded fallback below */ }
      }
      if (action === 'request') {
        if (operationEpoch.current !== submittingEpoch) return;
        if (error || result?.outcome !== 'email_requested') throw new Error('Email unavailable');
        setEmail({ ownerId, busy: false, message: 'Check your account email. The verification link expires after 15 minutes. Opening it does not delete your account.' });
        return;
      }
      // Confirmation is never automatically replayed, including an uncertain network result.
      if (operationEpoch.current !== submittingEpoch) throw new Error('Confirmation operation is no longer active');
      if (!result) throw new Error('Deletion result unverified');
      if (!confirmationId) throw new Error('Missing confirmation operation');
      if (result.accountDeleted === null) {
        accountDeletionAttempts.finish(ownerId, confirmationId, { phase: 'reconciliation',
          message: 'Account deletion could not be verified. It may already have happened. Do not request another link or retry deletion; contact support for reconciliation.' });
      } else if (result.accountDeleted) {
        const completionMessage = result.outcome === 'deleted'
          ? 'Your account has been deleted. Your trial email is retained to prevent repeat trials. Historical billing and support records may remain.'
          : 'Your account was deleted, but complete cleanup could not be verified. Please contact support.';
        accountDeletionAttempts.finish(ownerId, confirmationId, { phase: 'completed', message: completionMessage });
        setCompletion({ ownerId, message: completionMessage });
        try { await signOut(); } catch { /* deletion already happened; preserve the factual result */ }
      } else if (result.outcome === 'refused') {
        accountDeletionAttempts.finish(ownerId, confirmationId, { phase: 'ready',
          message: 'Verification was refused or expired. Request a new emailed link while signed in to the correct account.' });
      } else {
        accountDeletionAttempts.finish(ownerId, confirmationId, { phase: 'ready', message: result.billingClosed
          ? 'Billing is closed, but your account has not been deleted. Request a new verification link after one minute or contact support.'
          : 'Your account has not been deleted. Billing cancellation could not be confirmed. Request a new verification link after one minute or contact support.' });
      }
    } catch {
      if (action === 'request' && operationEpoch.current !== submittingEpoch) return;
      if (action === 'confirm' && confirmationId) {
        accountDeletionAttempts.finish(ownerId, confirmationId, { phase: 'reconciliation',
          message: 'We could not verify the deletion result. Do not assume your account or billing was changed. Please contact support before retrying.' });
      } else {
        setEmail({ ownerId, busy: false, message: 'We could not send a verification link. Please try again later or contact support.' });
      }
    } finally {
      inFlight.current = false;
      setEmail((current) => current?.ownerId === ownerId ? { ...current, busy: false } : current);
    }
  };

  return <main className="mx-auto max-w-2xl px-4 pb-24 pt-28" data-testid="account-deletion-page">
    <h1 className="text-3xl font-bold">Delete account</h1>
    {!completed && <>
      <p className="mt-4">Deleting your account is permanent. Your practice data and preferences will be removed.</p>
      <p className="mt-3">We will cancel your subscriptions and delete your Stripe customer. Deleting now ends access immediately and forfeits remaining paid time without a refund. If cancellation cannot be confirmed, deletion stops.</p>
      <p className="mt-3">Your trial email is retained to prevent repeat trials. Historical billing and support records may remain.</p>
      <p className="mt-3">To keep your account and use the rest of your paid period, cancel membership instead and return here later. Cancelling membership never schedules account deletion.</p>
      {confirmationBlocked ? null : loading ? <p role="status" className="mt-6">Checking your sign-in…</p> : !user ?
        <p className="mt-6"><Link to="/auth/signin">Sign in</Link> before requesting a verification link.</p> : token ?
          <div className="mt-6 space-y-4">
            <label className="flex items-start gap-3"><input type="checkbox" checked={confirmed}
              onChange={(e) => { if (user) setAcknowledgement({ ownerId: user.id, checked: e.target.checked }); }} disabled={busy} />
              <span>I understand this is permanent, ends my access now, and provides no refund.</span></label>
            <Button variant="destructive" disabled={!confirmed || busy} onClick={() => { void submit('confirm'); }}>
              {busy ? 'Deleting…' : 'Permanently delete my account'}
            </Button>
          </div> : <Button className="mt-6" disabled={busy} onClick={() => { void submit('request'); }}>
            {busy ? 'Sending…' : 'Email me a verification link'}
          </Button>}
    </>}
    {message && <p role="status" className="mt-6">{message}</p>}
    <p className="mt-6"><Link to="/">Return home</Link></p>
  </main>;
}

import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { accountDeletionToken, clearAccountDeletionToken } from '@/services/accountDeletionVerification';
import { Button } from '@/components/ui/button';

interface DeletionResponse {
  outcome?: 'email_requested' | 'deleted' | 'refused' | 'incomplete';
  accountDeleted?: boolean;
  billingClosed?: boolean;
  customerDeleted?: boolean;
}

function closureResponse(value: unknown): DeletionResponse | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (row.outcome === 'email_requested') return { outcome: 'email_requested' };
  if (!['deleted', 'refused', 'incomplete'].includes(String(row.outcome))
    || typeof row.accountDeleted !== 'boolean' || typeof row.billingClosed !== 'boolean'
    || typeof row.customerDeleted !== 'boolean') return null;
  if (row.outcome === 'deleted' && (row.accountDeleted !== true || row.billingClosed !== true)) return null;
  return row as unknown as DeletionResponse;
}

export default function AccountDeletionPage() {
  const { user, loading, signOut } = useAuthProvider();
  const [token, setToken] = useState(accountDeletionToken);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const inFlight = useRef(false);

  const submit = async (action: 'request' | 'confirm') => {
    if (inFlight.current || !user || (action === 'confirm' && (!token || !confirmed))) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const client = getSupabaseClient();
      if (!client) throw new Error('Unavailable');
      const { data, error } = await client.functions.invoke('account-closure', {
        body: action === 'request' ? { action } : { action, token, confirmIrreversible: true },
      });
      let result = closureResponse(data);
      if (!result && error && typeof error === 'object' && 'context' in error
        && error.context instanceof Response) {
        try { result = closureResponse(await error.context.json()); } catch { /* bounded fallback below */ }
      }
      if (action === 'request') {
        if (error || result?.outcome !== 'email_requested') throw new Error('Email unavailable');
        setMessage('Check your account email. The verification link expires after 15 minutes. Opening it does not delete your account.');
        return;
      }
      // Confirmation is never automatically replayed, including an uncertain network result.
      clearAccountDeletionToken();
      setToken(null);
      setConfirmed(false);
      if (!result) throw new Error('Deletion result unverified');
      if (result.accountDeleted) {
        setCompleted(true);
        try { await signOut(); } catch { /* deletion already happened; preserve the factual result */ }
        setMessage(result.outcome === 'deleted'
          ? 'Your account has been deleted. Your trial email is retained to prevent repeat trials. Historical billing and support records may remain.'
          : 'Your account was deleted, but complete cleanup could not be verified. Please contact support.');
      } else if (result.outcome === 'refused') {
        setMessage('Verification was refused or expired. Request a new emailed link while signed in to the correct account.');
      } else {
        setMessage(result.billingClosed
          ? 'Billing is closed, but your account has not been deleted. Request a new verification link after one minute or contact support.'
          : 'Your account has not been deleted. Billing cancellation could not be confirmed. Request a new verification link after one minute or contact support.');
      }
    } catch {
      if (action === 'confirm') {
        clearAccountDeletionToken();
        setToken(null);
      }
      setMessage(action === 'request'
        ? 'We could not send a verification link. Please try again later or contact support.'
        : 'We could not verify the deletion result. Do not assume your account or billing was changed. Please contact support before retrying.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return <main className="mx-auto max-w-2xl px-4 pb-24 pt-28" data-testid="account-deletion-page">
    <h1 className="text-3xl font-bold">Delete account</h1>
    {!completed && <>
      <p className="mt-4">Deleting your account is permanent. Your practice data and preferences will be removed.</p>
      <p className="mt-3">We will cancel your subscriptions and delete your Stripe customer. Deleting now ends access immediately and forfeits remaining paid time without a refund. If cancellation cannot be confirmed, deletion stops.</p>
      <p className="mt-3">Your trial email is retained to prevent repeat trials. Historical billing and support records may remain.</p>
      <p className="mt-3">To keep your account and use the rest of your paid period, cancel membership instead and return here later. Cancelling membership never schedules account deletion.</p>
      {loading ? <p role="status" className="mt-6">Checking your sign-in…</p> : !user ?
        <p className="mt-6"><Link to="/auth/signin">Sign in</Link> before requesting a verification link.</p> : token ?
          <div className="mt-6 space-y-4">
            <label className="flex items-start gap-3"><input type="checkbox" checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)} disabled={busy} />
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

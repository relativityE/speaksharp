import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { accountDeletionToken, consumeAccountDeletionToken } from '@/services/accountDeletionVerification';
import { accountDeletionAttempts } from '@/services/accountDeletionAttempts';
import { accountDeletionStatus, type AccountDeletionStatus } from '@/services/accountDeletionStatus';
import { Button } from '@/components/ui/button';
import { AccountCompletionStatusNotice } from '@/components/account/AccountCompletionStatusNotice';
import { completionCapabilities, type AccountCompletionStatus } from '@/services/accountCompletionStatus';
import { readCompletionStatus, secureStatusCapability } from '@/services/accountCompletionClient';
import { createCompletionTransport } from '@/services/accountCompletionTransport';

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
  const [status, setStatus] = useState<{ ownerId: string; value: AccountDeletionStatus | null; busy: boolean } | null>(null);
  const statusGeneration = useRef(0);
  const statusDeadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentStatus = status?.ownerId === user?.id ? status : null;
  const statusOwnerId = user?.id;
  const attempt = useSyncExternalStore(accountDeletionAttempts.subscribe,
    () => accountDeletionAttempts.snapshot(user?.id ?? null));
  const currentEmail = email?.ownerId === user?.id ? email : null;
  const currentCompletion = completion && (!user || completion.ownerId === user.id) ? completion : null;
  const confirmed = !!user && acknowledgement?.ownerId === user.id && acknowledgement.checked;
  const busy = !!currentEmail?.busy || attempt.phase === 'pending';
  const completed = !!currentCompletion || attempt.phase === 'completed';
  const confirmationBlocked = !!user && (attempt.phase === 'pending' || attempt.phase === 'reconciliation'
    || !currentStatus || currentStatus.busy || currentStatus.value?.outcome !== 'not_pending');
  const message = currentCompletion?.message
    ?? (currentStatus?.value?.outcome === 'pending' ? null
      : attempt.phase === 'ready' && currentEmail ? currentEmail.message : attempt.message);
  const inFlight = useRef(false);
  const operationEpoch = useRef(0);
  /**
   * #1643 completion status (inactive route; default-off answers unavailable). The pending request and its owner are
   * retained across sign-out so the capability-only read still works after the account's sign-in is gone; a different
   * owner signing in clears the capability and anything shown for the previous one. Every awaited result is fenced by
   * `completionGeneration`, and only `{owner, request}`-matching results render.
   */
  const completionTransport = useMemo(() => createCompletionTransport(import.meta.env.VITE_SUPABASE_URL), []);
  const completionGeneration = useRef(0);
  const [retained, setRetained] = useState<{ ownerId: string; requestId: string } | null>(null);
  const [completionView, setCompletionView] = useState<
    { ownerId: string; requestId: string; value: AccountCompletionStatus } | null>(null);
  const retainedOwner = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!user?.id) return; // Signed out (possibly because the account was deleted): keep the retained capability.
    if (retainedOwner.current !== null && retainedOwner.current !== user.id) {
      completionCapabilities.clear();
      completionGeneration.current += 1;
      setRetained(null);
      setCompletionView(null);
    }
    retainedOwner.current = user.id;
  }, [user?.id]);

  const readCompletion = useCallback(async (ownerId: string, requestId: string, generation: number) => {
    if (!completionTransport) return;
    const value = await readCompletionStatus(completionTransport, ownerId, requestId, Date.now);
    if (completionGeneration.current !== generation) return;
    // unavailable (incl. default-off/timeout) keeps today's pending display: never a completion inference.
    setCompletionView(value.outcome === 'unavailable' ? null : { ownerId, requestId, value });
  }, [completionTransport]);

  const loadCompletion = useCallback(async (ownerId: string, requestId: string, ownerJwt: string) => {
    const generation = ++completionGeneration.current;
    setRetained({ ownerId, requestId });
    if (!completionTransport) {
      setCompletionView(null);
      return;
    }
    const secured = await secureStatusCapability(completionTransport, ownerId, requestId, ownerJwt, Date.now);
    if (completionGeneration.current !== generation) return;
    if (!secured) {
      setCompletionView(null);
      return;
    }
    await readCompletion(ownerId, requestId, generation);
  }, [completionTransport, readCompletion]);

  const dropCompletion = useCallback(() => {
    completionGeneration.current += 1;
    setRetained(null);
    setCompletionView(null);
  }, []);

  /** Capability-only re-read for the retained request; never issues or acknowledges (no owner JWT is used). */
  // The signed-out recovery display follows the capability deadline by itself: one timer at `expiresAt` re-renders,
  // and `get` then clears the expired holding. Re-armed whenever the retained request or shown state changes.
  const [, setExpiryTick] = useState(0);
  useEffect(() => {
    if (!retained) return undefined;
    const held = completionCapabilities.get(retained.ownerId, retained.requestId, Date.now());
    if (!held) return undefined;
    const timer = setTimeout(() => setExpiryTick((n) => n + 1), Math.max(0, held.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [retained, completionView, user?.id]);

  const refreshCompletion = useCallback(() => {
    if (!retained) return;
    void readCompletion(retained.ownerId, retained.requestId, ++completionGeneration.current);
  }, [retained, readCompletion]);
  useLayoutEffect(() => {
    operationEpoch.current += 1;
    statusGeneration.current += 1;
    setAcknowledgement(null);
    setEmail(null);
    return () => {
      operationEpoch.current += 1;
      statusGeneration.current += 1;
      if (statusDeadline.current) clearTimeout(statusDeadline.current);
    };
  }, [user?.id]);

  const refreshStatus = useCallback(async () => {
    if (!statusOwnerId || loading) return;
    const ownerId = statusOwnerId;
    const generation = ++statusGeneration.current;
    if (statusDeadline.current) clearTimeout(statusDeadline.current);
    setStatus({ ownerId, value: null, busy: true });
    // A deadline fences the read's result; it never authorizes a confirmation retry.
    const timer = setTimeout(() => {
      if (statusGeneration.current !== generation) return;
      statusGeneration.current += 1;
      setStatus({ ownerId, value: null, busy: false });
      dropCompletion(); // an unverifiable read invalidates completion work too (Sam RETURN 1792558323)
    }, 15_000);
    statusDeadline.current = timer;
    try {
      const client = getSupabaseClient();
      if (!client) throw new Error('Unavailable');
      const { data: auth, error: authError } = await client.auth.getSession();
      if (statusGeneration.current !== generation) return;
      if (authError || auth.session?.user.id !== ownerId || !auth.session.access_token) throw new Error('Owner changed');
      // Pin the bearer to this owner, rather than resolving another account's token
      // asynchronously after an account switch. The server still authenticates it.
      const { data, error } = await client.functions.invoke('account-closure', {
        body: { action: 'status' }, headers: { Authorization: `Bearer ${auth.session.access_token}` },
      });
      if (statusGeneration.current !== generation) return;
      let value = error ? null : accountDeletionStatus(data);
      if (value?.outcome === 'pending' && !accountDeletionAttempts.observePending(ownerId, value.requestId)) value = null;
      setStatus({ ownerId, value, busy: false });
      // Completion status only for the pending request this owner-checked read just confirmed; anything else (not
      // pending, a different request, an unverifiable read) drops what was shown so no stale state survives.
      if (value?.outcome === 'pending') void loadCompletion(ownerId, value.requestId, auth.session.access_token);
      else dropCompletion();
    } catch {
      // Thrown legacy/Auth errors are unverifiable reads too; only the current generation may act on them.
      if (statusGeneration.current === generation) {
        setStatus({ ownerId, value: null, busy: false });
        dropCompletion();
      }
    } finally { clearTimeout(timer); }
  }, [statusOwnerId, loading, loadCompletion, dropCompletion]);

  useEffect(() => {
    void refreshStatus();
    return () => { statusGeneration.current += 1; };
  }, [refreshStatus]);

  const submit = async (action: 'request' | 'confirm') => {
    if (inFlight.current || !user || confirmationBlocked || accountDeletionAttempts.snapshot(user.id).phase !== 'ready'
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
      const pending = !error ? accountDeletionStatus(data) : null;
      if (pending?.outcome === 'pending' && confirmationId) {
        // Invalidate any status read started before confirmation committed.
        statusGeneration.current += 1;
        setStatus({ ownerId, value: pending, busy: false });
        accountDeletionAttempts.finish(ownerId, confirmationId, { phase: 'reconciliation',
          message: 'Your deletion request is pending. Your account has not been deleted. Previously accepted work must settle before deletion can proceed.' });
        if (!accountDeletionAttempts.observePending(ownerId, pending.requestId)) setStatus({ ownerId, value: null, busy: false });
        return;
      }
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

  // Render gate: a completion result shows only for the retained owner and request, and (while signed in) only for the
  // owner whose pending request the legacy read currently confirms.
  const signedInMatch = !user || (currentStatus?.value?.outcome === 'pending'
    && currentStatus.value.requestId === retained?.requestId && user.id === retained.ownerId);
  const shownCompletion = completionView && retained && signedInMatch
    && completionView.ownerId === retained.ownerId && completionView.requestId === retained.requestId
    ? completionView.value : null;
  // Signed-out recovery exists only with a retained, acknowledged, unexpired capability.
  const recoverable = !!retained && !!completionCapabilities.get(retained.ownerId, retained.requestId, Date.now())?.acknowledged;

  return <main className="mx-auto max-w-2xl px-4 pb-24 pt-28" data-testid="account-deletion-page">
    <h1 className="text-3xl font-bold">Delete account</h1>
    {!completed && <>
      <p className="mt-4">Deleting your account is permanent. Your practice data and preferences will be removed.</p>
      <p className="mt-3">Deletion requires confirmed billing cancellation and settlement of previously accepted work. It forfeits remaining paid time without a refund. Unverified outcomes remain pending.</p>
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
    {user && !completed && <>
      {(!currentStatus || currentStatus.busy) && <p role="status" className="mt-6">Checking your account deletion status…</p>}
      {currentStatus && !currentStatus.busy && !currentStatus.value && <p role="status" className="mt-6">We could not verify your account deletion status. Confirmation is blocked. Check status again or contact support.</p>}
      {currentStatus?.value?.outcome === 'pending' && (shownCompletion
        ? <div data-testid="account-completion-status"><AccountCompletionStatusNotice status={shownCompletion} /></div>
        : <p role="status" className="mt-6">Your deletion request is pending. Your account has not been deleted. Outstanding checkout operations: {currentStatus.value.checkoutPending}. No deletion will be retried from this page.</p>)}
      {currentStatus && !currentStatus.busy && (confirmationBlocked || currentStatus.value?.outcome === 'pending')
        && attempt.phase !== 'pending' && <Button className="mt-6" onClick={() => { void refreshStatus(); }}>Check deletion status</Button>}
    </>}
    {!user && !loading && !completed && recoverable && <>
      {shownCompletion
        ? <div data-testid="account-completion-status"><AccountCompletionStatusNotice status={shownCompletion} /></div>
        : <p role="status" className="mt-6">Your deletion request is pending. Check its status here.</p>}
      <Button className="mt-6" onClick={refreshCompletion}>Check deletion status</Button>
    </>}
    {message && <p role="status" className="mt-6">{message}</p>}
    <p className="mt-6"><Link to="/">Return home</Link></p>
  </main>;
}

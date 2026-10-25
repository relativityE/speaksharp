import type { AccountCompletionStatus, PendingCompletionReason } from '@/services/accountCompletionStatus';

const pendingReason: Record<PendingCompletionReason, string> = {
  coverage_unverified: 'We are still confirming everything linked to your account.',
  checkout_unsettled: 'A checkout is still being settled.',
  save_unsettled: 'A practice session is still being saved.',
  coaching_unsettled: 'A coaching request is still finishing.',
  ready: 'Earlier work is settled. Deletion has not started.',
};

/**
 * #1643 — one truthful sentence per closed completion state. Nothing here offers a retry or another deletion request
 * (every state is `canRetry:false`), and only `completed` — which the server returns only after verified residue — says
 * the account was deleted. Internal verification reasons are not shown: they would not change what the user can do.
 */
export function AccountCompletionStatusNotice({ status }: { status: AccountCompletionStatus }) {
  switch (status.outcome) {
    case 'pending':
      return <p role="status" className="mt-6">Your deletion request is pending. Your account has not been deleted. {pendingReason[status.reason]} Do not request deletion again.</p>;
    case 'processing':
      return <p role="status" className="mt-6">Your account is being deleted. Do not request deletion again; check back later for the result.</p>;
    case 'verification_pending':
      return <p role="status" className="mt-6">We cannot confirm the result of your deletion yet. Do not assume your account was or was not deleted, and do not request deletion again.</p>;
    case 'completed':
      return <p role="status" className="mt-6">Your account has been deleted.</p>;
    default:
      return <p role="status" className="mt-6">We could not verify your account deletion status. Check status again or contact support.</p>;
  }
}

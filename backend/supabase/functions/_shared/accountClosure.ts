/**
 * Account closure policy, separate from membership cancellation.
 * Adapters must atomically consume the emailed action token, paginate Stripe reads,
 * persist terminal billing snapshots, and verify deletion residue. No adapter here
 * defaults to success; this module alone is not a deployed deletion endpoint.
 */
export interface ClosureProof {
  userId: string;
  email: string;
  customerId: string | null;
  requestId: string;
  expiresAt: number;
}

export interface SubscriptionPage {
  subscriptions: { id: string; status: string }[];
  complete: boolean;
}

export interface ClosureDependencies {
  now(): number;
  /** Atomic single-use claim; identity/billing fields come from authoritative storage. */
  consumeProof(userId: string, token: string): Promise<ClosureProof | null>;
  listSubscriptions(customerId: string): Promise<SubscriptionPage>;
  cancelSubscription(id: string, options: {
    invoice_now: false; prorate: false; idempotencyKey: string;
  }): Promise<void>;
  /** Preserve terminal webhook settlement before customer/auth deletion. */
  settleBilling(userId: string, subscriptions: SubscriptionPage['subscriptions']): Promise<void>;
  deleteCustomer(customerId: string): Promise<{ deleted: boolean }>;
  /** Retain only the trial-prevention record; the FK becomes NULL on auth deletion. */
  preserveTrialEmail(userId: string, email: string): Promise<void>;
  deleteAuthUser(userId: string): Promise<{ deleted: boolean }>;
  /** Must separately verify auth absence, cascading rows and declared retained exceptions. */
  verifyResidue(userId: string): Promise<{ clean: boolean }>;
}

export type ClosureStage = 'verification' | 'subscriptions' | 'billing_settlement'
  | 'customer_deletion' | 'trial_retention' | 'account_deletion' | 'residue';
export interface ClosureResult {
  outcome: 'deleted' | 'refused' | 'incomplete';
  stage: ClosureStage;
  billingClosed: boolean;
  customerDeleted: boolean;
  accountDeleted: boolean;
}

const terminal = (status: string) => status === 'canceled' || status === 'incomplete_expired';

export async function closeAccount(
  authenticatedUserId: string,
  emailedToken: string,
  deps: ClosureDependencies,
): Promise<ClosureResult> {
  const result: ClosureResult = {
    outcome: 'refused', stage: 'verification', billingClosed: false,
    customerDeleted: false, accountDeleted: false,
  };
  if (!authenticatedUserId || !emailedToken) return result;
  try {
    const proof = await deps.consumeProof(authenticatedUserId, emailedToken);
    const now = deps.now();
    if (!proof || proof.userId !== authenticatedUserId || !proof.requestId
      || !proof.email || !Number.isFinite(now) || !Number.isFinite(proof.expiresAt)
      || proof.expiresAt <= now || proof.customerId === '') return result;

    result.outcome = 'incomplete';
    if (proof.customerId) {
      result.stage = 'subscriptions';
      const before = await deps.listSubscriptions(proof.customerId);
      if (before.complete !== true || !Array.isArray(before.subscriptions)) return result;
      for (const sub of before.subscriptions) {
        if (!sub.id || !sub.status) return result;
        if (!terminal(sub.status)) {
          await deps.cancelSubscription(sub.id, {
            invoice_now: false, prorate: false,
            idempotencyKey: `account-closure:${proof.requestId}:${sub.id}`,
          });
        }
      }
      const after = await deps.listSubscriptions(proof.customerId);
      if (after.complete !== true || !Array.isArray(after.subscriptions)
        || after.subscriptions.some((sub) => !sub.id || !terminal(sub.status))) return result;
      // A missing subscription in a supposedly complete read must not silently settle.
      if (before.subscriptions.some((sub) => !after.subscriptions.some((s) => s.id === sub.id))) return result;
      result.stage = 'billing_settlement';
      await deps.settleBilling(proof.userId, after.subscriptions);
      result.billingClosed = true;
      result.stage = 'customer_deletion';
      if ((await deps.deleteCustomer(proof.customerId)).deleted !== true) return result;
      result.customerDeleted = true;
    } else {
      result.billingClosed = true;
    }

    result.stage = 'trial_retention';
    await deps.preserveTrialEmail(proof.userId, proof.email);
    result.stage = 'account_deletion';
    if ((await deps.deleteAuthUser(proof.userId)).deleted !== true) return result;
    result.accountDeleted = true;
    result.stage = 'residue';
    if ((await deps.verifyResidue(proof.userId)).clean !== true) return result;
    result.outcome = 'deleted';
    return result;
  } catch {
    // Provider errors may contain customer/email/token data. Return bounded state only.
    return result;
  }
}

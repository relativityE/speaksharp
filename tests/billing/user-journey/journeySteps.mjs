// The billing journeys and the steps each must prove. One source for the spec (via contract.ts) and for the
// workflow's combined-receipt finalizer (localStackReceipt.mjs), so the two can't drift.
export const BILLING_JOURNEYS = Object.freeze(['conversion', 'renewal_recovery', 'portal_expiry']);
export const REQUIRED_STEPS = Object.freeze({
  conversion: Object.freeze(['trial_granted', 'trial_expired', 'repeated_click_one_session', 'checkout_cancelled',
    'checkout_retried', 'hosted_checkout', 'first_invoice', 'stripe_delivery',
    'paid_entitlement', 'returned_to_app', 'paid_ui', 'reload', 'sign_in_again', 'next_recording', 'cleanup']),
  renewal_recovery: Object.freeze(['hosted_checkout', 'first_invoice', 'stripe_delivery', 'paid_entitlement',
    'renewal_paid', 'renewal_delivery', 'failure_observed', 'failure_delivery', 'access_revoked',
    'recovery_paid', 'recovery_delivery', 'access_restored', 'cleanup']),
  portal_expiry: Object.freeze(['hosted_checkout', 'first_invoice', 'stripe_delivery', 'paid_entitlement',
    'portal_opened', 'portal_cancelled', 'cancellation_delivery', 'paid_until_period_end',
    'expiry_delivery', 'access_expired', 'account_retained', 'history_retained', 'cleanup']),
});

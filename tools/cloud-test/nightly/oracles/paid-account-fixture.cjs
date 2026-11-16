"use strict";
// Nightly AHT suite, J9.a: the long-lived paid account. No real charge (Akin, 14 Nov): the fixture exists only in
// Stripe test mode (the #1795 sandbox), and every check here refuses anything live. Its result is sandbox proof, never
// production billing proof (J9.b stays NOT RUN). Creating the fixture is NOT implemented: it must sign up and pay
// through the product in test mode on a named earlier release, and that build is a separate, reviewed step.
class LiveModeRefused extends Error {
    constructor(reason) { super(`J9 refuses anything outside Stripe test mode: ${reason}`); this.name = 'LiveModeRefused'; }
}
/** Fails closed unless the key, the customer and the subscription are all Stripe test mode; returns true when they are. */
function assertTestModeFixture(f, stripeKey, customer, subscription) {
    if (f.stripeMode !== 'test')
        throw new LiveModeRefused('the fixture is not marked test mode');
    if (!stripeKey || !/^(sk|rk)_test_/.test(stripeKey))
        throw new LiveModeRefused('the Stripe key is not a test-mode key');
    if (customer.id !== f.customerId || subscription.id !== f.subscriptionId)
        throw new LiveModeRefused('the Stripe objects are not the fixture\'s');
    if (customer.livemode !== false || subscription.livemode !== false)
        throw new LiveModeRefused('a Stripe object is live mode');
    if (!/^[0-9a-f]{40}$/.test(f.recordedOnRelease))
        throw new LiveModeRefused('the fixture does not name the exact release it was recorded on');
    // The proof the portal check requires: only an explicit true lets a session be created.
    return true;
}
class FixtureNotBuilt extends Error {
    constructor() { super('the J9.a test-mode paid account fixture is not built yet (flagged): J9.a is NOT RUN'); this.name = 'FixtureNotBuilt'; }
}
/** Deliberately unimplemented. J9.a's gate (`test-mode-fixture`) stays unmet until a reviewed build replaces this. */
function loadPaidAccountFixture() {
    throw new FixtureNotBuilt();
}

module.exports = { FixtureNotBuilt, LiveModeRefused, assertTestModeFixture, loadPaidAccountFixture };

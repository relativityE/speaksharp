/**
 * The run-owned disposable account a supplemental RWT scenario starts from: preconditions and the separate canary-claim
 * acknowledgement checked before any Production write, a fresh signup with its identity verified, the server-issued
 * canary claim applied, and a fresh sign-in that carries it. Any missing step HOLDs the receipt before scenario traffic.
 * Same steps as the #1594 boundary specs, shared here by the R1/R2 specs.
 */
import type { Page } from '@playwright/test';
import {
    RWT_CANARY_CLAIM_ACK_VALUE, type RwtReceipt, canaryClaimAuthorized, installMicAcquisitionCounter,
    markRunOwnedAccountCanary, newDisposableEmail, requireApprovedSurface, rwtPreconditionFailures, runOwnedIdentityFailures,
    signUpDisposableAccount,
} from './rwtJourney';

export type RunOwner = {
    email: string; uid: string;
    /** Sign this run-owned account in on another device's page (an isolated context); the password stays private. */
    signInOn?: (other: Page) => Promise<void>;
};

export async function prepareRunOwnedAccount(
    page: Page, receipt: RwtReceipt, owner: RunOwner, label: string, admin: unknown, serviceRole: string,
): Promise<boolean> {
    const missing = rwtPreconditionFailures();
    if (!canaryClaimAuthorized() || process.env.RWT_CANARY_CLAIM_ACK !== RWT_CANARY_CLAIM_ACK_VALUE) {
        missing.push('AUTHORIZATION GATE: the separate run-owned canary-claim acknowledgement is absent');
    }
    if (missing.length > 0) {
        receipt.halt('preflight', `HOLD before Production writes: ${missing.join('; ')}`);
        return false;
    }
    await installMicAcquisitionCounter(page);
    await page.goto('/auth/signup');
    await requireApprovedSurface(page, receipt);
    owner.email = newDisposableEmail(label);
    receipt.forbid(owner.email, serviceRole);
    const account = await signUpDisposableAccount(page, owner.email);
    owner.uid = account.uid;
    owner.signInOn = account.signInOn;
    const identity = await runOwnedIdentityFailures(admin as never, owner.uid, owner.email);
    if (identity.length > 0) throw new Error(`run-owned identity preflight failed: ${identity.join('; ')}`);
    receipt.row('run-owned signup', 'PASS', 'fresh disposable account and profile verified');
    const claimed = await markRunOwnedAccountCanary(admin as never, owner.uid, owner.email);
    if (!claimed) {
        receipt.halt('canary claim', 'HOLD before qualifying traffic: the run-owned canary claim was not applied');
        return false;
    }
    await account.signOutAndSignIn();
    const hasClaim = await page.evaluate(() => Object.keys(localStorage).some((key) => {
        if (!/^sb-.*-auth-token$/.test(key)) return false;
        try { return JSON.parse(localStorage.getItem(key) ?? '{}').user?.app_metadata?.canary === true; }
        catch { return false; }
    }));
    receipt.row('canary claim in fresh login', hasClaim ? 'PASS' : 'FAIL', hasClaim
        ? 'fresh sign-in carries the run-owned server-issued canary claim' : 'fresh sign-in lacks the run-owned canary claim');
    if (!hasClaim) {
        receipt.halt('canary claim', 'HOLD before scenario traffic: the fresh-login canary claim was absent');
        return false;
    }
    return true;
}

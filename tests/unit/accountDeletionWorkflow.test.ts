// @vitest-environment node
/**
 * The J1.f / J7.d deletion workflow (.github/workflows/account-deletion-local-stack.yml): protected, main-only, one run for both
 * legs, deletion enabled on the disposable stack only, the grant seeded last, and each leg scored by deletionReceipt.mjs.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const wf = readFileSync('.github/workflows/account-deletion-local-stack.yml', 'utf8');
const billing = readFileSync('.github/workflows/billing-local-stack-journey.yml', 'utf8');
const at = (needle: string) => { const i = wf.indexOf(needle); if (i < 0) throw new Error(`missing in the workflow: ${needle}`); return i; };

describe('account deletion local-stack workflow', () => {
    it('is dispatch-only on the protected billing-local-stack environment, main only, in the shared Stripe concurrency group', () => {
        expect(wf).toMatch(/^on:\n {2}workflow_dispatch:/m);
        expect(wf).not.toMatch(/^ {2}(push|pull_request|schedule):/m);
        expect(wf).toContain('    environment: billing-local-stack\n');
        expect(wf).toContain("[ \"$REF\" = 'refs/heads/main' ] || { echo '::error::Account deletion runs from main only.'; exit 1; }");
        expect(wf).toContain('  group: stripe-commercial-lifecycle\n  cancel-in-progress: false');
        expect(wf).toContain('permissions:\n  contents: read\n');
    });
    it('checks the approved test account and the checkout-session headroom before anything is created, and never writes to Stripe', () => {
        expect(at('Stripe account check and checkout-session headroom')).toBeLessThan(at('actions/checkout@v6'));
        expect(wf).toContain("echo 'headroom=false' >> \"$GITHUB_OUTPUT\"");
        expect(wf).not.toMatch(/stripe listen|curl[^\n]*-X POST|-d [a-z_]+=/);
    });
    it('seeds the disposable grant last, right before the functions and the journeys', () => {
        const order = ['Build and serve this commit\'s app', 'Install Chromium', 'Enable deletion on THIS stack only',
            'Serve this commit\'s Edge functions locally', 'Run both deletion journeys'].map(at);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        expect(wf).toContain('node tests/billing/user-journey/accountDeletionLocalStack.mjs prepare --project "$LOCAL_STACK_PROJECT"');
        expect(wf).toContain('psql "$LOCAL_DB_URL" -X -q -f "$RUNNER_TEMP/deletion-seed.sql"');
        expect(wf).toContain('cat "$RUNNER_TEMP/deletion-grant.env"');
    });
    it('runs both legs in one job and scores each with deletionReceipt.mjs after a checked teardown and destruction proof', () => {
        expect(wf).toContain('pnpm exec playwright test -c playwright.account-deletion.config.ts');
        const order = ['Verify no Stripe test fixture remains', 'Tear down the local stack', 'Prove the disposable stack was destroyed', 'Score J1.f and J7.d'].map(at);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        expect(wf).toContain('node tests/billing/user-journey/deletionReceipt.mjs --receipt "$receipt"');
        expect(wf).not.toContain('localStackReceipt.mjs');
        // Sam on a718da25: the browser journeys' own step outcome is scored, not just the backend deletion.
        expect(wf).toContain('JOURNEYS: ${{ steps.journeys.outcome }}');
        expect(wf).toContain('--journeys "$JOURNEYS"');
    });
    it('uploads content-free files only and removes the grant and the functions env on teardown', () => {
        const upload = wf.slice(at('actions/upload-artifact@v4'));
        expect(upload).not.toMatch(/functions\.env|deletion-grant|deletion-seed/);
        expect(wf).toContain('rm -f "$RUNNER_TEMP/functions.env" "$RUNNER_TEMP/deletion-grant.env" "$RUNNER_TEMP/deletion-seed.sql"');
    });
    it('leaves the billing journey workflow without any deletion wiring', () => {
        expect(billing).not.toMatch(/account_deletion|accountDeletionLocalStack|deletionReceipt/);
    });
});

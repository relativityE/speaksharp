import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

/**
 * #1390 Stage 1 — the internal Preview deployment workflow is a DEPLOYMENT AUTHORITY, so the properties
 * that keep it safe are asserted rather than trusted to review.
 *
 * The danger is specific: a workflow that can build an internal artifact and push it to Vercel is one
 * edit away from pushing it to production, or from deploying whatever a branch happens to point at. Each
 * test below names the failure it prevents, because a guard whose purpose is not written down is a guard
 * someone eventually "simplifies".
 */
const root = process.cwd();
const WF_PATH = '.github/workflows/internal-preview-deploy.yml';
const text = readFileSync(resolve(root, WF_PATH), 'utf8');
const doc = yaml.load(text);
const job = doc.jobs['internal-preview'];
const steps = job.steps;
const stepNamed = (name) => steps.find((s) => s.name === name);
const verifier = readFileSync(resolve(root, 'scripts/ci/verify-internal-preview.mjs'), 'utf8');

describe('dispatch-only: a deployment happens because a PERSON asked, never because a branch moved', () => {
    it('workflow_dispatch is the ONLY trigger', () => {
        expect(Object.keys(doc.on)).toEqual(['workflow_dispatch']);
    });

    it.each(['push', 'schedule', 'pull_request', 'release', 'repository_dispatch'])(
        'has no %s trigger', (trigger) => {
            expect(doc.on[trigger]).toBeUndefined();
        });

    it('requires an explicit source SHA input', () => {
        const input = doc.on.workflow_dispatch.inputs.source_sha;
        expect(input).toBeTruthy();
        expect(input.required).toBe(true);
    });
});

describe('exact-SHA checkout: "contains the commit" is not "is the commit"', () => {
    it('checks out the requested ref rather than a branch head', () => {
        const checkout = steps.find((s) => typeof s.uses === 'string' && s.uses.startsWith('actions/checkout'));
        expect(checkout.with.ref).toBe('${{ inputs.source_sha }}');
    });

    it('CASUALTY: refuses to build when HEAD differs from the requested SHA', () => {
        // Without this, every downstream claim about "this SHA" is unverified: the checkout action is
        // trusted to resolve a ref, not to have resolved the one we meant.
        const guard = stepNamed('Fail unless HEAD equals the requested SHA');
        expect(guard).toBeTruthy();
        expect(guard.run).toMatch(/git rev-parse HEAD/);
        expect(guard.run).toMatch(/!=\s*"\$REQUESTED_SHA"/);
        expect(guard.run).toMatch(/exit 1/);
    });

    it('rejects a short or malformed SHA before doing any work', () => {
        const validate = stepNamed('Validate requested SHA shape');
        expect(validate.run).toMatch(/\[0-9a-f\]\{40\}/);
        expect(validate.run).toMatch(/exit 1/);
        expect(steps.indexOf(validate)).toBeLessThan(
            steps.findIndex((s) => typeof s.uses === 'string' && s.uses.startsWith('actions/checkout')),
        );
    });
});

describe('Preview only: production must be unreachable, not merely unintended', () => {
    it('CASUALTY: no --prod path exists anywhere in the workflow', () => {
        expect(text).not.toMatch(/--prod\b/);
        expect(text).not.toMatch(/vercel\s+--prod/);
    });

    it('CASUALTY: refuses a production customer host returned by the deploy', () => {
        // A "preview" that answers on the customer origin is the exact failure this file's shape exists
        // to prevent, and it is decided by the HOST — not by the URL, which a path could impersonate.
        const guard = stepNamed('Refuse a production customer host');
        expect(guard).toBeTruthy();
        expect(guard.run).toMatch(/speaksharp\.app/);
        expect(guard.run).toMatch(/vercel\.app/);
        expect(guard.run).toMatch(/exit 1/);
    });

    it('the host refusal runs BEFORE the preview is verified or reported', () => {
        const refuse = steps.indexOf(stepNamed('Refuse a production customer host'));
        const verify = steps.indexOf(stepNamed('Verify the running Preview'));
        expect(refuse).toBeGreaterThan(-1);
        expect(refuse).toBeLessThan(verify);
    });

    it('makes no production-environment mutation', () => {
        expect(text).not.toMatch(/gh (secret|variable) set/);
        expect(text).not.toMatch(/vercel env (add|rm)/);
        expect(text).not.toMatch(/supabase (secrets|db)/);
    });

    it('requests read-only repository permissions', () => {
        expect(doc.permissions).toEqual({ contents: 'read' });
    });
});

describe('internal flag injection: for THIS build only', () => {
    it('CASUALTY: the build step sets VITE_INTERNAL_BUILD=true', () => {
        const build = stepNamed('Build internal Preview artifact');
        expect(build.env.VITE_INTERNAL_BUILD).toBe('true');
    });

    it('the release identity is the REQUESTED SHA, not the runner ref', () => {
        // BUILD_ID is first-precedence in vite.config.mjs. Without it the page would report whatever
        // commit the runner checked out under, which is the thing we are trying to prove.
        const build = stepNamed('Build internal Preview artifact');
        expect(build.env.BUILD_ID).toBe('${{ inputs.source_sha }}');
    });

    it('the flag is scoped to the build step and set nowhere else', () => {
        expect(doc.env?.VITE_INTERNAL_BUILD).toBeUndefined();
        expect(job.env?.VITE_INTERNAL_BUILD).toBeUndefined();
        const setters = steps.filter((s) => s.env && 'VITE_INTERNAL_BUILD' in s.env);
        expect(setters).toHaveLength(1);
        expect(setters[0].name).toBe('Build internal Preview artifact');
    });

    it('client configuration comes from the approved GitHub homes', () => {
        const build = stepNamed('Build internal Preview artifact');
        expect(build.env.VITE_SUPABASE_URL).toMatch(/vars\.SUPABASE_URL/);
        expect(build.env.VITE_SUPABASE_ANON_KEY).toMatch(/secrets\.SUPABASE_ANON_KEY/);
    });
});

describe('secrets are consumed, never emitted', () => {
    it('CASUALTY: no step echoes, cats or writes a secret expression', () => {
        // `echo "${{ secrets.X }}"` would print a credential into a log that outlives the run.
        const emitting = /(echo|printf|cat|tee)[^\n]*\$\{\{\s*secrets\./;
        expect(text).not.toMatch(emitting);
    });

    it('no secret is written into an output, summary or file', () => {
        expect(text).not.toMatch(/GITHUB_OUTPUT[^\n]*secrets\./);
        expect(text).not.toMatch(/GITHUB_STEP_SUMMARY[^\n]*secrets\./);
        expect(text).not.toMatch(/GITHUB_ENV[^\n]*secrets\./);
    });

    it('the deploy suppresses CLI chatter that could carry the token', () => {
        const deploy = stepNamed('Deploy to Vercel Preview');
        expect(deploy.run).toMatch(/2>\/dev\/null/);
    });

    it('the summary emits only content-safe fields', () => {
        const summary = stepNamed('Content-safe summary');
        expect(summary.run).not.toMatch(/secrets\./);
        expect(summary.run).toMatch(/Source SHA/);
        expect(summary.run).toMatch(/Preview URL/);
        expect(summary.run).toMatch(/Internal comparison evidence only/);
    });

    it('the automation-bypass secret is used only for the bounded readback', () => {
        const users = steps.filter((s) => s.env && 'VERCEL_AUTOMATION_BYPASS_SECRET' in s.env);
        expect(users).toHaveLength(1);
        expect(users[0].name).toBe('Verify the running Preview');
    });
});

describe('the verifier checks the RUNNING page, not the build', () => {
    it('asserts the runtime release equals the requested SHA', () => {
        expect(verifier).toMatch(/__APP_RELEASE__/);
        expect(verifier).toMatch(/does not equal the requested SHA/);
    });

    it('CASUALTY: chunk presence alone is NOT accepted as proof the switch installs', () => {
        // An earlier version of this check grepped the bundle for the surface identifiers and found them
        // in BOTH builds, because the module ships either way and the install is gated at runtime.
        // The distinguishing fact is the inlined internal-build literal.
        expect(verifier).toMatch(/VITE_INTERNAL_BUILD\\s\*:\\s\*"true"|VITE_INTERNAL_BUILD:"true"/);
        expect(verifier).toMatch(/would not install/);
    });

    it('requires BOTH switch surfaces', () => {
        expect(verifier).toMatch(/__SS_SWITCH_CANDIDATE__/);
        expect(verifier).toMatch(/__SS_ACTIVE_CANDIDATE__/);
    });

    it('emits no environment value or token', () => {
        expect(verifier).not.toMatch(/console\.log\([^)]*process\.env/);
        expect(verifier).not.toMatch(/console\.log\([^)]*bypass/);
    });
});

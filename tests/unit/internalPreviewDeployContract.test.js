import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
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
    it('the SUBJECT checkout uses the requested ref, not a branch head', () => {
        // Two checkouts now exist: trusted control from main, and the subject under test.
        const subject = steps.find((s) => typeof s.uses === 'string'
            && s.uses.startsWith('actions/checkout') && s.with?.path === 'subject');
        expect(subject.with.ref).toBe('${{ inputs.source_sha }}');
    });

    it('CASUALTY: refuses to build when HEAD differs from the requested SHA', () => {
        // Without this, every downstream claim about "this SHA" is unverified: the checkout action is
        // trusted to resolve a ref, not to have resolved the one we meant.
        const guard = stepNamed('Fail unless the subject HEAD equals the requested SHA');
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

    it('CASUALTY: the verifier EXECUTES the page — text inspection cannot decide PASS', () => {
        // INVERTED. This previously required the verifier to grep the bundle for an inlined literal,
        // which encoded the rejected proof method as a requirement: the switch module ships in BOTH
        // builds, so a page whose install never runs passed every text check. PASS is now decided by
        // evaluating the live window in a real browser.
        expect(verifier).toMatch(/from 'playwright'/);
        expect(verifier).toMatch(/page\.evaluate\(/);
        expect(verifier).toMatch(/typeof window\.__SS_SWITCH_CANDIDATE__/);
        expect(verifier).toMatch(/typeof window\.__SS_ACTIVE_CANDIDATE__/);
        // No text-matching may stand in for the runtime check.
        expect(verifier, 'bundle text must not decide the verdict')
            .not.toMatch(/chunk\.includes\(/);
    });

    it('CASUALTY: it fails closed on timeout, navigation or evaluation failure', () => {
        // "Could not check" must never read as "checked and fine".
        expect(verifier).toMatch(/timeout:/);
        expect(verifier).toMatch(/verification could not complete/);
        expect(verifier).toMatch(/process\.exit\(1\)/);
    });

    it('the workflow installs a browser, because the verifier needs one', () => {
        const setup = steps.find((s) => typeof s.uses === 'string' && s.uses.includes('setup-environment'));
        expect(setup.with['install-playwright']).toBe('true');
    });
});

/**
 * #1390 RETURN — UNTRUSTED CODE MUST NEVER MEET THE PREVIEW SECRETS.
 *
 * The workflow validated only that `source_sha` looked like a SHA, then checked that tree out and ran
 * `verify-internal-preview.mjs` from it with VERCEL_AUTOMATION_BYPASS_SECRET in scope. Any collaborator
 * branch commit could have replaced that script and read or exfiltrated the secret. "PM-authorized"
 * existed only in the input's description and enforced nothing.
 */
describe('#1390 RETURN — only reviewed code runs, and only main may dispatch', () => {
    const stepIndex = (name) => steps.findIndex((s) => s.name === name);

    it('CASUALTY: a non-main workflow ref is refused', () => {
        // workflow_dispatch runs the workflow DEFINITION from the ref it is launched on, so a modified
        // copy of this file would otherwise run with the Preview secrets attached.
        const guard = stepNamed('Refuse a non-main workflow ref');
        expect(guard).toBeTruthy();
        // The CONDITION, not merely the words around it. Asserting that "refs/heads/main" and "exit 1"
        // appear somewhere in the step passed even when the test disabled the comparison entirely —
        // the message and the exit survive in the dead branch.
        expect(guard.run).toMatch(/if\s*\[\s*"\$WORKFLOW_REF"\s*!=\s*"refs\/heads\/main"\s*\]/);
        expect(guard.run).toMatch(/exit 1/);
        expect(stepIndex('Refuse a non-main workflow ref')).toBe(0);
    });

    it('CASUALTY: a branch-only SHA is rejected BEFORE any secret-bearing step', () => {
        const ancestry = stepNamed('Require the requested SHA to be an ancestor of origin/main');
        expect(ancestry).toBeTruthy();
        expect(ancestry.run).toMatch(/if ! git merge-base --is-ancestor "\$REQUESTED_SHA" origin\/main; then/);
        expect(ancestry.run).toMatch(/exit 1/);
        // Every step that carries a secret must come after it.
        const secretSteps = steps
            .map((s, i) => ({ i, s }))
            .filter(({ s }) => JSON.stringify(s.env ?? {}).includes('secrets.'));
        const gate = stepIndex('Require the requested SHA to be an ancestor of origin/main');
        for (const { i, s } of secretSteps) {
            expect(i, `"${s.name}" carries a secret before the ancestry gate`).toBeGreaterThan(gate);
        }
    });

    it('CASUALTY: a modified verifier in the SUBJECT tree is never executed', () => {
        // The control script is run from the trusted checkout. Running the subject copy is exactly how a
        // branch commit would have consumed the bypass secret.
        // The trusted tree is now the workspace ROOT, so "trusted" is the bare path and "untrusted" is
        // anything reached through `subject/`.
        const verify = stepNamed('Verify the running Preview');
        expect(verify.run).toMatch(/node\s+scripts\/ci\/verify-internal-preview\.mjs/);
        expect(verify.run, 'the subject tree copy must not be invoked')
            .not.toMatch(/subject\/scripts\/ci\/verify-internal-preview\.mjs/);
    });

    it('control and subject are SEPARATE checkouts', () => {
        const checkouts = steps.filter((s) => typeof s.uses === 'string' && s.uses.startsWith('actions/checkout'));
        expect(checkouts).toHaveLength(2);
        expect(checkouts[0].with.ref, 'the trusted tree is checked out first').toBe('main');
        expect(checkouts[0].with.path, 'and it occupies the workspace root').toBeUndefined();
        expect(checkouts[1].with.ref).toBe('${{ inputs.source_sha }}');
        expect(checkouts[1].with.path, 'the subject is nested beneath it').toBe('subject');
    });

    it('the composite action is taken from the trusted checkout', () => {
        const setup = steps.find((s) => typeof s.uses === 'string' && s.uses.includes('setup-environment'));
        expect(setup.uses, 'the action comes from the trusted root, never from subject/')
            .toBe('./.github/actions/setup-environment');
    });

    it('CASUALTY: the Vercel CLI is pinned, never `latest`', () => {
        // `vercel@latest` executes whatever that tag resolves to at run time, with the deploy token in scope.
        expect(text).not.toMatch(/vercel@latest/);
        expect(stepNamed('Deploy to Vercel Preview').run).toMatch(/vercel@\d+\.\d+\.\d+/);
    });

    it('only ONE explicit artifact path is deployed, and it is the assembled root', () => {
        // This asserted the bare `subject/frontend/dist`, which is now the DEFECT: that path makes the
        // built directory the deployment root and leaves `vercel.json` outside it. The assembled root is
        // the artifact plus the derived config, and it is still a single explicit path — never the repo.
        const run = stepNamed('Deploy to Vercel Preview').run;
        expect(run).toMatch(/deploy preview-deploy-root/);
        expect(run, 'deploying the whole checkout would upload the subject tree').not.toMatch(/deploy \.\s/);
        expect(stepNamed('Assemble the deploy root (artifact + derived vercel.json)').run)
            .toMatch(/subject\/frontend\/dist/);
    });

    it('a main-ancestor exact SHA is still accepted — the gate is not a blanket refusal', () => {
        const ancestry = stepNamed('Require the requested SHA to be an ancestor of origin/main');
        // Refusal is conditional on the ancestry test failing, not unconditional.
        expect(ancestry.run).toMatch(/if ! git merge-base --is-ancestor/);
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

/**
 * #1390 RETURN — THE EXECUTION LAYOUT, EXERCISED RATHER THAN DESCRIBED.
 *
 * The returned defect was not a policy hole; it was that the job could not run at all. Both checkouts were
 * nested (`control/` and `subject/`), leaving the workspace ROOT with no `package.json` — and
 * `setup-environment` activates pnpm by evaluating `require('./package.json').packageManager` from the
 * root. The job died there, before the build, every time. Reading the file could not reveal that: the YAML
 * is perfectly well-formed and every guard it declares is real. Only running the thing it depends on shows
 * it.
 *
 * So this block RECONSTRUCTS the runner's workspace from the workflow's own checkout declarations and
 * EXECUTES the composite action's real resolution command inside it. Nothing here is a text match. Move a
 * checkout back under a subdirectory and these fail, because the reconstructed root stops holding the file
 * the action reads.
 */
describe('#1390 RETURN — the workspace layout, reconstructed and executed', () => {
    const checkouts = steps.filter((s) => typeof s.uses === 'string' && s.uses.startsWith('actions/checkout'));
    /** Where each checkout lands, relative to the workspace root. '' means the root itself. */
    const layout = checkouts.map((s) => ({ ref: String(s.with.ref), dir: s.with.path ?? '' }));
    const trusted = layout.find((c) => c.ref === 'main');
    const subject = layout.find((c) => c.ref !== 'main');

    /** Build a real directory tree matching what `actions/checkout` would produce for this workflow. */
    function materializeWorkspace() {
        const ws = mkdtempSync(join(tmpdir(), 'ipd-layout-'));
        for (const { dir } of layout) {
            const target = dir ? join(ws, dir) : ws;
            mkdirSync(target, { recursive: true });
            // Both refs are this repository, so both trees carry these two files.
            copyFileSync(resolve(root, 'package.json'), join(target, 'package.json'));
            copyFileSync(resolve(root, 'pnpm-lock.yaml'), join(target, 'pnpm-lock.yaml'));
        }
        return ws;
    }

    it('CASUALTY: the composite action RESOLVES pnpm in the reconstructed root', () => {
        // The exact expression `setup-environment` runs, read from the action rather than retyped, so a
        // change there cannot drift away from this proof.
        const action = readFileSync(resolve(root, '.github/actions/setup-environment/action.yml'), 'utf8');
        const line = action.split('\n').find((l) => l.includes("require('./package.json')"));
        expect(line, 'setup-environment must still resolve packageManager from the root').toBeTruthy();
        const expr = line.match(/node -p "([^"]+)"/)[1];

        const ws = materializeWorkspace();
        try {
            // EXECUTED. Under the returned layout the root held no package.json and this threw
            // MODULE_NOT_FOUND — which is exactly how the job failed on a real runner.
            const out = execFileSync(process.execPath, ['-p', expr], { cwd: ws, encoding: 'utf8' }).trim();
            expect(out, 'the root must yield a pnpm packageManager pin').toMatch(/^pnpm@\d+\.\d+\.\d+/);
        } finally {
            rmSync(ws, { recursive: true, force: true });
        }
    });

    it('CASUALTY: every declared working-directory exists in the reconstructed workspace', () => {
        const ws = materializeWorkspace();
        try {
            const dirs = steps.map((s) => s['working-directory']).filter(Boolean);
            expect(dirs.length, 'the subject steps must declare where they run').toBeGreaterThan(0);
            for (const d of dirs) {
                expect(existsSync(join(ws, d)), `working-directory "${d}" is not a checkout target`).toBe(true);
            }
        } finally {
            rmSync(ws, { recursive: true, force: true });
        }
    });

    it('CASUALTY: the trusted tree is the ROOT and the subject is nested beneath it', () => {
        expect(trusted, 'main must be checked out').toBeTruthy();
        expect(trusted.dir, 'trusted main belongs at the workspace root').toBe('');
        expect(subject.dir, 'the subject tree must be nested, never the root').toBe('subject');
    });

    it("CASUALTY: the composite action's path resolves to a real file in the trusted tree", () => {
        const setup = steps.find((s) => typeof s.uses === 'string' && s.uses.includes('setup-environment'));
        const rel = setup.uses.replace(/^\.\//, '');
        expect(rel.startsWith('subject/'), 'the action must never come from the subject tree').toBe(false);
        expect(existsSync(resolve(root, rel, 'action.yml')),
            `${setup.uses} must resolve inside the trusted checkout`).toBe(true);
    });

    it('CASUALTY: the verifier is executed from the trusted tree, at a path that exists', () => {
        const step = stepNamed('Verify the running Preview');
        const m = step.run.match(/node\s+(\S+verify-internal-preview\.mjs)/);
        expect(m, 'the verify step must invoke the verifier').toBeTruthy();
        expect(m[1].startsWith('subject/'), 'never run the subject tree copy').toBe(false);
        expect(existsSync(resolve(root, m[1])), `${m[1]} must exist in the trusted tree`).toBe(true);
    });

    it('CASUALTY: the subject is INSTALLED before it is built', () => {
        // Without its own node_modules the subject tree cannot build; `setup-environment` installs at the
        // root, which is main, not the commit being deployed.
        const names = steps.map((s) => s.name);
        const install = names.findIndex((n) => /Install subject dependencies/i.test(n));
        const build = names.findIndex((n) => /Build internal Preview artifact/i.test(n));
        expect(install, 'the subject must be installed').toBeGreaterThan(-1);
        expect(build).toBeGreaterThan(-1);
        expect(install, 'install must precede build').toBeLessThan(build);
        expect(steps[install]['working-directory'], 'and it must install the SUBJECT tree').toBe('subject');
        expect(steps[install].run).toMatch(/--frozen-lockfile/);
    });

    it('CASUALTY: installing untrusted code sees NO secret', () => {
        // `pnpm install` runs the deployed commit's lifecycle scripts. If a secret were in scope there,
        // every guard above would be decoration.
        const install = steps.find((s) => /Install subject dependencies/i.test(s.name || ''));
        expect(install.env, 'the install step must declare no environment at all').toBeUndefined();
        expect(job.env, 'a job-level env would put secrets in every step, including the install').toBeUndefined();
        expect(doc.env, 'and so would a workflow-level env').toBeUndefined();
    });

    it('CASUALTY: no secret is in scope before the subject is installed', () => {
        const names = steps.map((s) => s.name);
        const install = names.findIndex((n) => /Install subject dependencies/i.test(n));
        const earlier = steps.slice(0, install);
        for (const s of earlier) {
            const declared = JSON.stringify(s.env ?? {});
            expect(declared, `"${s.name}" must not carry a secret before installation`)
                .not.toMatch(/secrets\./);
        }
    });
});

/**
 * #1390 RETURN — DEPLOYMENT BINDING AND CONFIGURATION, EXECUTED.
 *
 * Two linked defects, both invisible to the previous verifier because it checked release identity and
 * the switch surfaces, and neither of those depends on which project received the deployment or on
 * whether the deployed root carried any configuration.
 *
 *   1. `.vercel/project.json` is gitignored, so nothing links the runner's checkout to a project.
 *      Vercel's unlinked-CI contract needs BOTH org and project ids; with only one the command is not
 *      reliably bound, and `--yes` accepts defaults rather than authenticating a project.
 *   2. `vercel deploy subject/frontend/dist` makes `dist` the deployment root while `vercel.json` sits
 *      at the repository root, outside it — so the Preview lost the SPA fallback, the /api rewrite,
 *      COOP/COEP, and the sw.js cache header. A Preview that is not cross-origin isolated cannot give
 *      the Private engine SharedArrayBuffer, and one without the SPA fallback 404s on every deep link.
 *
 * The projection and the predicates below are RUN, not read.
 */
describe('#1390 RETURN — the deployment is bound to one project in one organization', () => {
    const deployStep = stepNamed('Deploy to Vercel Preview');
    const receiptStep = stepNamed('Confirm the deployment belongs to the expected project and organization');

    it('CASUALTY: BOTH the organization and the project identity are supplied', () => {
        // The returned head supplied only the project id.
        expect(deployStep.env, 'the deploy step must declare an environment').toBeTruthy();
        expect(JSON.stringify(deployStep.env)).toMatch(/VERCEL_ORG_ID/);
        expect(JSON.stringify(deployStep.env)).toMatch(/VERCEL_PROJECT_ID/);
    });

    it('CASUALTY: the deploy FAILS CLOSED when either identity is absent', () => {
        // Deploying with one missing is the unbound state the ids exist to prevent.
        expect(deployStep.run).toMatch(/VERCEL_ORG_ID:-.*refusing to deploy unbound/s);
        expect(deployStep.run).toMatch(/VERCEL_PROJECT_ID:-.*refusing to deploy unbound/s);
    });

    it('CASUALTY: the deployment RECEIPT is checked, not just the request', () => {
        // Passing the ids asks for a binding; only the receipt confirms Vercel applied it.
        expect(receiptStep, 'a receipt step must exist').toBeTruthy();
        expect(receiptStep.run).toMatch(/api\.vercel\.com/);
        expect(receiptStep.run).toMatch(/DIFFERENT Vercel project/);
        expect(receiptStep.run).toMatch(/DIFFERENT Vercel organization/);
    });

    it('the receipt step runs BEFORE the Preview is verified or summarised', () => {
        const names = steps.map((s) => s.name);
        expect(names.indexOf('Confirm the deployment belongs to the expected project and organization'))
            .toBeLessThan(names.indexOf('Verify the running Preview'));
    });

    it('neither identifier is ever echoed', () => {
        const shown = `${deployStep.run}\n${receiptStep.run}`;
        expect(shown, 'comparison only, never disclosure').not.toMatch(/echo .*\$\{?VERCEL_(ORG|PROJECT)_ID/);
    });
});

describe('#1390 RETURN — the deployed root carries the product configuration', () => {
    const repoConfig = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'));

    it('CASUALTY: the projection carries the rewrites and headers VERBATIM', async () => {
        const { deploymentConfigFrom } = await import('../../scripts/ci/build-preview-deploy-root.mjs');
        const out = deploymentConfigFrom(repoConfig);
        expect(out.rewrites, 'the SPA fallback and /api rewrite must survive').toEqual(repoConfig.rewrites);
        expect(out.headers, 'COOP/COEP and the sw.js cache header must survive').toEqual(repoConfig.headers);
    });

    it('CASUALTY: build-time keys are DROPPED — this is a prebuilt upload with no source in it', async () => {
        const { deploymentConfigFrom } = await import('../../scripts/ci/build-preview-deploy-root.mjs');
        const out = deploymentConfigFrom(repoConfig);
        for (const key of ['buildCommand', 'installCommand', 'outputDirectory', 'ignoreCommand', 'framework']) {
            expect(out, `${key} would ask Vercel to rebuild a directory with no source`).not.toHaveProperty(key);
        }
    });

    it('CASUALTY: a config with no rewrites is REFUSED rather than deployed', async () => {
        const { deploymentConfigFrom } = await import('../../scripts/ci/build-preview-deploy-root.mjs');
        expect(() => deploymentConfigFrom({ ...repoConfig, rewrites: [] }))
            .toThrow(/SPA fallback/);
    });

    it('CASUALTY: a config with no headers is REFUSED — an un-isolated Preview is not deployable', async () => {
        const { deploymentConfigFrom } = await import('../../scripts/ci/build-preview-deploy-root.mjs');
        expect(() => deploymentConfigFrom({ ...repoConfig, headers: [] }))
            .toThrow(/cross-origin isolated/);
    });

    it("CASUALTY: the workflow deploys the ASSEMBLED root, never the bare dist", () => {
        const deployStep = stepNamed('Deploy to Vercel Preview');
        expect(deployStep.run).toMatch(/vercel@\d+\.\d+\.\d+ deploy preview-deploy-root/);
        expect(deployStep.run, 'deploying dist directly is the defect').not.toMatch(/deploy subject\/frontend\/dist/);
        expect(stepNamed('Assemble the deploy root (artifact + derived vercel.json)').run)
            .toMatch(/build-preview-deploy-root\.mjs/);
    });

    it('the repository config still declares what the Preview depends on', () => {
        // If the product drops COOP/COEP or the SPA fallback, the projection above would faithfully
        // carry that away — so the source of truth is asserted too.
        const all = JSON.stringify(repoConfig.headers);
        expect(all).toMatch(/Cross-Origin-Opener-Policy/);
        expect(all).toMatch(/Cross-Origin-Embedder-Policy/);
        expect(JSON.stringify(repoConfig.rewrites)).toMatch(/"destination":\s*"\/"/);
    });
});

describe('#1390 RETURN — the verifier proves isolation and routing', () => {
    it('CASUALTY: COOP absent or wrong FAILS', async () => {
        const { coopOk } = await import('../../scripts/ci/verify-internal-preview.mjs');
        expect(coopOk({ 'cross-origin-opener-policy': 'same-origin' })).toBe(true);
        expect(coopOk({}), 'absence is not isolation').toBe(false);
        expect(coopOk({ 'cross-origin-opener-policy': 'unsafe-none' })).toBe(false);
    });

    it('CASUALTY: COEP absent or wrong FAILS', async () => {
        const { coepOk } = await import('../../scripts/ci/verify-internal-preview.mjs');
        expect(coepOk({ 'cross-origin-embedder-policy': 'credentialless' })).toBe(true);
        expect(coepOk({ 'cross-origin-embedder-policy': 'require-corp' })).toBe(true);
        expect(coepOk({}), 'absence is not isolation').toBe(false);
        expect(coepOk({ 'cross-origin-embedder-policy': 'unsafe-none' })).toBe(false);
    });

    it('CASUALTY: a deep route returning a platform 404 FAILS', async () => {
        const { deepRouteServesApp } = await import('../../scripts/ci/verify-internal-preview.mjs');
        expect(deepRouteServesApp({ status: 200, bodyHasAppRoot: true, bodyLooksLikePlatform404: false })).toBe(true);
        expect(deepRouteServesApp({ status: 404, bodyHasAppRoot: false, bodyLooksLikePlatform404: true })).toBe(false);
        // A rewrite can also answer 200 with the platform's own page; status alone is not the check.
        expect(deepRouteServesApp({ status: 200, bodyHasAppRoot: false, bodyLooksLikePlatform404: true })).toBe(false);
        expect(deepRouteServesApp({ status: 200, bodyHasAppRoot: false, bodyLooksLikePlatform404: false })).toBe(false);
    });

    it('CASUALTY: the live verifier asserts isolation, both headers and a non-root route', () => {
        expect(verifier).toMatch(/crossOriginIsolated/);
        expect(verifier).toMatch(/coopOk\(headers\)/);
        expect(verifier).toMatch(/coepOk\(headers\)/);
        expect(verifier).toMatch(/deepRouteServesApp\(/);
        expect(verifier, 'the deep route must be fetched, not assumed').toMatch(/page\.goto\(deepUrl/);
    });
});

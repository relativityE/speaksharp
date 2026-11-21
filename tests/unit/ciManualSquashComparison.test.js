import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { manualSquashAuditReceipt, resolveVerifiedSquashComparison } from '../../scripts/lib/ciManualSquashComparison.mjs';

describe('manual-squash comparison from the displaced main tree', () => {
    it('does not inspect any squash input on PR, merge queue, or manual dispatch', async () => {
        for (const GITHUB_EVENT_NAME of ['pull_request','merge_group','workflow_dispatch']) {
            expect(await resolveVerifiedSquashComparison('/not-a-repo', { GITHUB_EVENT_NAME })).toBeNull();
        }
    });
    it('emits an old/new audit receipt, not a current PR review', () => {
        const before = '1'.repeat(40), after = '2'.repeat(40);
        const proof = { ok:true,beforeSha:before,afterSha:after,treeSha:'3'.repeat(40),priorCiRunId:4,priorCiAttempt:1,
            approvalCommentId:'IC_owner',pushActivityId:5,baselineRef:'refs/tags/v1.0.0',baselineSha:'6'.repeat(40) };
        const env = { GITHUB_SHA:after,GITHUB_RUN_ID:'7',GITHUB_RUN_ATTEMPT:'2' };
        const receipt = manualSquashAuditReceipt(proof,env);
        expect(receipt).toMatchObject({kind:'manual-unchanged-tree-squash-verification',
            from:{commit:before,runId:4,attempt:1},
            to:{commit:after,runId:'7',attempt:'2',review:'no-new-pr-review-claimed'}});
        expect(receipt).not.toHaveProperty('qualified');
        expect(() => manualSquashAuditReceipt(proof,{...env,GITHUB_SHA:before})).toThrow('audit identity incomplete');
        expect(() => manualSquashAuditReceipt({...proof,priorCiAttempt:undefined},env)).toThrow('audit identity incomplete');
    });
    it.each(['verify','wrong tree','owner denied','event base mismatch','ordinary push'])('%s', async control => {
        const root = mkdtempSync(join(tmpdir(), 'ci-squash-test-'));
        try {
            const git = (...args) => execFileSync('git', args, { cwd:root, encoding:'utf8' }).trim();
            git('init','-q'); git('config','user.name','test'); git('config','user.email','test@example.com');
            const initial = git('commit-tree', git('write-tree'), '-m','initial');
            mkdirSync(join(root,'scripts/lib'), { recursive:true });
            writeFileSync(join(root,'scripts/lib/releaseSquashTrust.mjs'),
                "export const acquireManualSquashTrust = ({event,token})=>token=== 'allowed'\n" +
                " ? {ok:true,beforeSha:event.before,afterSha:event.after,treeSha:event.fixtureTree}\n" +
                " : {ok:false,reason:'approval-missing'};");
            git('add','scripts');
            const beforeTree = git('write-tree'), before = git('commit-tree',beforeTree,'-p',initial,'-m','old');
            if (control === 'wrong tree') {
                writeFileSync(join(root,'change'),'added');
                git('add','change');
            }
            const after = git('commit-tree',git('write-tree'),'-p',initial,'-m','new');
            git('checkout','-q','--detach',after);
            // An uncommitted false-positive module must not be imported from the checkout.
            writeFileSync(join(root,'scripts/lib/releaseSquashTrust.mjs'), "throw Error('candidate read')");
            const eventPath = join(root,'event.json');
            const repo = 'relativityE/speaksharp', ref = 'refs/heads/main';
            writeFileSync(eventPath,JSON.stringify({ before, after, ref, repository:{full_name:repo}, created:false,
                deleted:false, forced:control!=='ordinary push', fixtureTree:beforeTree }));
            const result = resolveVerifiedSquashComparison(root,{
                GITHUB_EVENT_NAME:'push', GITHUB_REPOSITORY:repo, GITHUB_REF:ref, GITHUB_SHA:after,
                GITHUB_EVENT_PATH:eventPath, TEST_EFFICACY_EVENT_BASE:control==='event base mismatch' ? after : before,
                SQUASH_TRUST_TOKEN: control === 'owner denied' ? '' : 'allowed',
            });
            const observed = await result.then(value => ({value}), error => ({error:error.message}));
            const expected = {
                verify: {value:{base:after,head:after}},
                'ordinary push': {value:null},
                'wrong tree': {error:'Forced main tree differs'},
                'owner denied': {error:'Manual squash verification HOLD: approval-missing'},
                'event base mismatch': {error:'Unbound forced-main push'},
            };
            expect(observed).toEqual(expected[control]);
        } finally { rmSync(root,{recursive:true,force:true}); }
    });
});

it('real CI steps only hand the empty comparison and separate audit receipt to a verified push', () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
    const root = mkdtempSync(join(tmpdir(), 'ci-squash-workflow-'));
    try {
        const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
        git('init', '-q'); git('config', 'user.name', 'Workflow fixture'); git('config', 'user.email', 'fixture@example.invalid');
        const checkpoint = git('commit-tree', git('write-tree'), '-m', 'checkpoint');
        mkdirSync(join(root, 'scripts/lib'), { recursive: true });
        mkdirSync(join(root, 'scripts/j1d-smoke'), { recursive: true });
        const trust = 'scripts/lib/releaseSquashTrust.mjs';
        const comparison = 'scripts/lib/ciManualSquashComparison.mjs';
        copyFileSync(join(repoRoot, comparison), join(root, comparison));
        writeFileSync(join(root, trust), `
            export const acquireManualSquashTrust = ({event, token}) => token !== 'fixture-trust'
                ? {ok:false, reason:'approval-missing'}
                : {ok:true, beforeSha:event.before, afterSha:event.after, treeSha:event.fixtureTree, priorCiRunId:52,
                    priorCiAttempt:2, approvalCommentId:'IC_fixture', pushActivityId:55,
                    baselineRef:'refs/tags/v1.0.0', baselineSha:event.fixtureBaseline};
        `);
        writeFileSync(join(root, 'scripts/lib/testExecutionEvidence.mjs'),
            "export const resolveCiComparison = () => { throw Error('Unexpected fallback comparison'); };");
        writeFileSync(join(root, 'scripts/j1d-smoke/smokeEvidence.mjs'),
            "export const smokeAffected = paths => paths.length > 0;");
        git('add', 'scripts');
        const tree = git('write-tree');
        const before = git('commit-tree', tree, '-p', checkpoint, '-m', 'old full history');
        const after = git('commit-tree', tree, '-p', checkpoint, '-m', 'synthetic squash');
        git('checkout', '-q', '--detach', after);
        const marker = join(root, 'event.json'), output = join(root, 'output'), envFile = join(root, 'write-env');
        writeFileSync(marker, JSON.stringify({ before, after, ref: 'refs/heads/main', forced: true, created: false, deleted: false,
            repository:{full_name:'relativityE/speaksharp'}, fixtureTree:tree, fixtureBaseline:checkpoint }));
        const env = { PATH: process.env.PATH, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main',
            GITHUB_SHA: after, GITHUB_REPOSITORY: 'relativityE/speaksharp', GITHUB_EVENT_PATH: marker, GITHUB_OUTPUT: output,
            GITHUB_ENV: envFile, RUNNER_TEMP: root, GITHUB_RUN_ID: '26', GITHUB_RUN_ATTEMPT: '1',
            TEST_EFFICACY_EVENT_BASE: before, SQUASH_TRUST_TOKEN: 'fixture-trust' };
        const ci = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
        const run = (name, overrides = {}) => {
            const body = ci.split('- name: ' + name + '\n')[1].split("<<'NODE'\n")[1].split('\n          NODE')[0]
                .split('\n').map(line => line.slice(10)).join('\n');
            return spawnSync(process.execPath, ['--input-type=module', '-e', body], { cwd: root, env: {...env, ...overrides}, encoding: 'utf8' });
        };
        const scope = 'Bind disposable smoke scope and quality comparison to this checkout';
        const writer = 'Resolve exact efficacy comparison base';
        const audit = 'Verify owner-approved unchanged-tree history rewrite';
        const denied = run(scope, { SQUASH_TRUST_TOKEN: '' });
        expect(denied.status).toBe(1);
        expect(denied.stderr).toContain('approval-missing');
        expect(existsSync(output)).toBe(false);
        const scoped = run(scope);
        expect({status:scoped.status, stderr:scoped.stderr}).toMatchObject({status:0});
        expect(readFileSync(output, 'utf8')).toBe(`base=${after}\nhead=${after}\nrequired=false\n`);
        const wrongHandoff = run(writer, { TEST_EFFICACY_HEAD: after, TEST_EFFICACY_BASE: before });
        expect(wrongHandoff.status).toBe(1);
        expect(wrongHandoff.stderr).toContain('Unbound scope/quality comparison');
        expect(existsSync(envFile)).toBe(false);
        const agreed = run(writer, { TEST_EFFICACY_HEAD: after, TEST_EFFICACY_BASE: after });
        expect({status:agreed.status, stderr:agreed.stderr}).toMatchObject({status:0});
        expect(readFileSync(envFile, 'utf8')).toBe(`TEST_EFFICACY_BASE=${after}\n`);
        const verified = run(audit);
        expect({status:verified.status, stderr:verified.stderr}).toMatchObject({status:0});
        const receipt = JSON.parse(readFileSync(join(root, 'manual-squash-verification.json'), 'utf8'));
        expect(receipt).toMatchObject({kind:'manual-unchanged-tree-squash-verification', from:{commit:before}, to:{commit:after}});
        expect(receipt).not.toHaveProperty('qualified');
    } finally { rmSync(root, { recursive:true, force:true }); }
});

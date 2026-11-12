import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain ESM script, no types
import { classifyChanges } from '../../scripts/ci-change-scope.mjs';

const draft = { isDraft: true, eventName: 'pull_request' as const };

describe('#1054 CI change classifier', () => {
    describe('always selects the FULL lane (fail-safe)', () => {
        it.each([
            { label: 'push to main', files: ['README.md'], ctx: { ...draft, eventName: 'push' as const } },
            // #1501: even a docs-only diff with a stray draft flag runs the full lane in the merge queue.
            { label: 'merge-queue candidate (merge_group)', files: ['README.md'], ctx: { ...draft, eventName: 'merge_group' as const } },
            { label: 'explicit force_full', files: ['README.md'], ctx: { ...draft, forceFull: true } },
            { label: 'non-draft PR (merge candidate)', files: ['README.md'], ctx: { isDraft: false } },
            // #1837: a docs-lane candidate the reader guard has not confirmed takes the full lane.
            { label: 'non-draft docs PR without guard confirmation', files: ['docs/x.md'], ctx: { isDraft: false } },
            { label: 'non-draft docs PR, guard confirmation not exactly true', files: ['docs/x.md'], ctx: { isDraft: false, docsLaneConfirmed: 'true' as unknown as boolean } },
            { label: 'merge-queue docs candidate even when confirmed', files: ['docs/x.md'], ctx: { isDraft: false, eventName: 'merge_group' as const, docsLaneConfirmed: true } },
            { label: 'push of docs even when confirmed', files: ['docs/x.md'], ctx: { isDraft: false, eventName: 'push' as const, docsLaneConfirmed: true } },
            { label: 'force_full docs PR even when confirmed', files: ['docs/x.md'], ctx: { isDraft: false, forceFull: true, docsLaneConfirmed: true } },
            { label: 'empty diff', files: [], ctx: draft },
            { label: 'unresolvable diff (null)', files: null as unknown as string[], ctx: draft },
        ])('$label', ({ files, ctx }) => {
            expect(classifyChanges(files, ctx).full_required).toBe(true);
        });

        it.each([
            '.github/workflows/ci.yml',
            'scripts/test-audit.sh',
            'scripts/run-ci.mjs',
            'tools/cloud-test/harness-adapter/build_plan.py',
            'tools/cloud-test/harness/bundle/harness/campaign-core.cjs',
            'tools/cloud-test/report/workflow_report.py',
            'tools/cloud-test/scripts/verify_release.py',
            'package.json',
            'pnpm-lock.yaml',
            'frontend/vitest.config.mjs',
            'frontend/vite.config.ts',
            'playwright.config.ts',
            'tsconfig.json',
            'backend/supabase/migrations/20260724220000_sessions_attribution_status.sql',
            // control/config files that previously slipped through as "narrow"
            'frontend/package.json',
            'frontend/tsconfig.app.json',
            'frontend/tailwind.config.js',
            'frontend/postcss.config.js',
            'eslint.config.js',
            'backend/supabase/config.toml',
            'backend/supabase/functions/deno.json',
            'backend/supabase/functions/import_map.json',
            'vercel.json',
        ])('control path %s forces full', (file) => {
            expect(classifyChanges([file], draft).full_required).toBe(true);
        });

        it.each([
            'backend/some-other-service/thing.ts',
            'frontend/scripts/gen.mjs',
            'infra/terraform/main.tf',
        ])('unmapped path %s forces full (no blanket frontend/** or backend/** recognition)', (file) => {
            expect(classifyChanges([file], draft).full_required).toBe(true);
        });

        it('an UNCLASSIFIED path forces full (unknown impact never downgrades validation)', () => {
            const r = classifyChanges(['some/brand/new/thing.conf'], draft);
            expect(r.full_required).toBe(true);
            expect(r.reason).toMatch(/unclassified_path/);
        });

        it('a control path mixed into an otherwise narrow change still forces full', () => {
            expect(classifyChanges(['frontend/src/lib/x.ts', 'pnpm-lock.yaml'], draft).full_required).toBe(true);
        });
    });

    describe('affected draft lane', () => {
        it('docs-only → docs_only, no build, no E2E', () => {
            const r = classifyChanges(['README.md', 'product_release/RELEASE_STATUS.md', 'docs/x.md'], draft);
            expect(r).toMatchObject({ full_required: false, docs_only: true, frontend_changed: false, e2e_required: false });
        });

        it('non-UI frontend source → frontend build, no E2E', () => {
            const r = classifyChanges(['frontend/src/lib/formatting.ts'], draft);
            expect(r).toMatchObject({ full_required: false, docs_only: false, frontend_changed: true, e2e_required: false });
        });

        it.each([
            'frontend/src/pages/SessionPage.tsx',
            'frontend/src/components/session/StatusNotificationBar.tsx',
            'frontend/src/hooks/useSessionLifecycle.ts',
            'frontend/src/services/SpeechRuntimeController.ts',
            'tests/e2e/session.e2e.spec.ts',
        ])('user-visible surface %s requires browser validation', (file) => {
            expect(classifyChanges([file], draft)).toMatchObject({ full_required: false, e2e_required: true });
        });

        it('edge function change → edge tests only', () => {
            const r = classifyChanges(['backend/supabase/functions/report-issue/index.ts'], draft);
            expect(r).toMatchObject({ full_required: false, edge_changed: true, frontend_changed: false });
        });

        it('a directly changed unit test is narrow scope, not full', () => {
            const r = classifyChanges(['frontend/src/services/__tests__/SpeechRuntimeController.test.ts'], draft);
            expect(r.full_required).toBe(false);
        });

        it('a confirmed non-draft docs PR takes the docs lane, not the draft lane', () => {
            const r = classifyChanges(['README.md', 'docs/guide/x.md'], { isDraft: false, docsLaneConfirmed: true });
            expect(r).toMatchObject({ full_required: false, docs_lane: true, docs_lane_candidate: true, docs_only: true,
                frontend_changed: false, edge_changed: false, e2e_required: false, reason: 'docs_lane' });
        });

        it.each([
            ['Markdown under the app', 'frontend/README.md'],
            ['Markdown under the backend', 'backend/supabase/functions/README.md'],
            ['Markdown under cloud-test tooling', 'tools/cloud-test/README.md'],
            ['a canonical release document', 'product_release/ROADMAP.md'],
            ['release evidence', 'product_release/evidence/x.md'],
            ['Markdown on a control path', 'scripts/README.md'],
            ['Markdown in workflow config', '.github/PULL_REQUEST_TEMPLATE.md'],
            ['a non-Markdown doc', 'docs/notes.txt'],
            ['a padded path', ' docs/x.md'],
        ])('never offers the docs lane for %s', (_label, file) => {
            const r = classifyChanges(['docs/ok.md', file], { isDraft: false, docsLaneConfirmed: true });
            expect(r).toMatchObject({ full_required: true, docs_lane: false, docs_lane_candidate: false });
        });

        it('docs + code is NOT docs_only', () => {
            expect(classifyChanges(['README.md', 'frontend/src/lib/x.ts'], draft).docs_only).toBe(false);
        });
    });
});

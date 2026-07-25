import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain ESM script, no types
import { classifyChanges } from '../../scripts/ci-change-scope.mjs';

const draft = { isDraft: true, eventName: 'pull_request' as const };

describe('#1054 CI change classifier', () => {
    describe('always selects the FULL lane (fail-safe)', () => {
        it.each([
            { label: 'push to main', files: ['README.md'], ctx: { ...draft, eventName: 'push' as const } },
            { label: 'explicit force_full', files: ['README.md'], ctx: { ...draft, forceFull: true } },
            { label: 'non-draft PR (merge candidate)', files: ['README.md'], ctx: { isDraft: false } },
            { label: 'empty diff', files: [], ctx: draft },
            { label: 'unresolvable diff (null)', files: null as unknown as string[], ctx: draft },
        ])('$label', ({ files, ctx }) => {
            expect(classifyChanges(files, ctx).full_required).toBe(true);
        });

        it.each([
            '.github/workflows/ci.yml',
            'scripts/test-audit.sh',
            'scripts/run-ci.mjs',
            'package.json',
            'pnpm-lock.yaml',
            'frontend/vitest.config.mjs',
            'frontend/vite.config.ts',
            'playwright.config.ts',
            'tsconfig.json',
            'backend/supabase/migrations/20260724220000_sessions_attribution_status.sql',
        ])('control path %s forces full', (file) => {
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

        it('docs + code is NOT docs_only', () => {
            expect(classifyChanges(['README.md', 'frontend/src/lib/x.ts'], draft).docs_only).toBe(false);
        });
    });
});

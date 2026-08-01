import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workflow = readFileSync(resolve('.github/workflows/stt-runtime-evidence.yml'), 'utf8');

describe('#1037 Private-v2 runtime evidence workflow contract', () => {
    it('checks out, builds, labels, and names evidence from one canonical exact SHA', () => {
        const canonicalEvidenceSha =
            "EVIDENCE_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}";

        expect(workflow.split(canonicalEvidenceSha)).toHaveLength(2);
        expect(workflow).toContain('ref: ${{ env.EVIDENCE_SHA }}');
        expect(workflow).toContain('BUILD_ID="${{ env.EVIDENCE_SHA }}"');
        expect(workflow).toContain('--release-sha "${{ env.EVIDENCE_SHA }}"');
        expect(workflow).toContain('name: stt-private-v2-worker-evidence-${{ env.EVIDENCE_SHA }}');
        expect(workflow).not.toMatch(/BUILD_ID=.*github\.(?:event\.pull_request\.head\.sha|sha)/);
        expect(workflow).not.toMatch(/--release-sha.*github\.(?:event\.pull_request\.head\.sha|sha)/);

        expect(workflow).toContain('pnpm build:test');
        expect(workflow).toContain('pnpm exec vite preview');
        expect(workflow).not.toMatch(/pnpm exec vite --config/);
    });

    it('fails when the mandatory evidence artifact is absent and retains it for one day', () => {
        expect(workflow).toContain('if-no-files-found: error');
        expect(workflow).toContain('retention-days: 1');
    });

    it('installs the repository-standard Chromium runtime before browser evidence runs', () => {
        const installIndex = workflow.indexOf('run: pnpm pw:install');
        const evidenceIndex = workflow.indexOf('pnpm evidence:stt:private-worker');

        expect(installIndex).toBeGreaterThan(-1);
        expect(evidenceIndex).toBeGreaterThan(installIndex);
    });

    it('reruns for bounded production worker, thread-policy, config, model, and evidence dependencies', () => {
        for (const path of [
            "frontend/src/services/transcription/engines/**",
            "frontend/src/services/transcription/utils/**",
            'frontend/src/config/TestFlags.ts',
            'frontend/public/models/whisper-base.en/**',
            'scripts/private-v2-worker-evidence.mts',
            'tests/evidence/**',
        ]) {
            expect(workflow).toContain(`- '${path}'`);
        }
    });
});

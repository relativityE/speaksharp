import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workflow = readFileSync(resolve('.github/workflows/stt-runtime-evidence.yml'), 'utf8');
const corpusWorkflow = readFileSync(resolve('.github/workflows/stt-corpus-lane.yml'), 'utf8');
const producer = readFileSync(resolve('scripts/private-v2-worker-evidence.mts'), 'utf8');

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

    it('checks out the corpus producer at the same canonical exact head recorded in its row', () => {
        const canonicalEvidenceSha =
            "EVIDENCE_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}";

        expect(corpusWorkflow.split(canonicalEvidenceSha)).toHaveLength(2);
        expect(corpusWorkflow).toContain('ref: ${{ env.EVIDENCE_SHA }}');
        expect(corpusWorkflow).toContain('--release-sha "${{ env.EVIDENCE_SHA }}"');
        expect(corpusWorkflow).not.toContain('--release-sha "${{ github.event.pull_request.head.sha || github.sha }}"');
    });

    it('claims only requested/configured one-thread evidence and leaves effective worker threads unreported', () => {
        expect(workflow).toContain('private-v2-production-worker-one-thread-request-config');
        expect(workflow).toContain('one-thread request/configuration');
        expect(workflow).not.toContain('single-thread fallback');
        expect(producer).toContain('one thread requested/configured; effective worker threads unreported');
    });

    it('rejects an empty transcript before writing the evidence artifact', () => {
        const guardIndex = producer.indexOf('privateWorkerTranscriptProblems(transcript)');
        const writeIndex = producer.indexOf('writeFileSync(outPath');

        expect(guardIndex).toBeGreaterThan(-1);
        expect(writeIndex).toBeGreaterThan(guardIndex);
    });

    it('publishes the isolated worker result only as an unverified, WER-free diagnostic', () => {
        expect(producer).toContain("attribution_status: 'unverified'");
        expect(producer).toContain('wer: null');
        expect(producer).toContain('unverifiedWorkerDiagnosticProblems(row)');
        expect(producer).not.toContain("attribution_status: 'verified'");
        expect(workflow).toContain('Upload validated unverified diagnostic evidence');
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

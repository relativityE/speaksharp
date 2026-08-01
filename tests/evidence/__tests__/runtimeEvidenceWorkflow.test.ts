import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workflow = readFileSync(resolve('.github/workflows/stt-runtime-evidence.yml'), 'utf8');

describe('#1037 Private-v2 runtime evidence workflow contract', () => {
    it('builds the exact head and serves the emitted production bundle', () => {
        expect(workflow).toContain('pnpm build:test');
        expect(workflow).toContain('pnpm exec vite preview');
        expect(workflow).not.toMatch(/pnpm exec vite --config/);
        expect(workflow).toContain('BUILD_ID="${{ github.event.pull_request.head.sha || github.sha }}"');
    });

    it('fails when the mandatory evidence artifact is absent and retains it for one day', () => {
        expect(workflow).toContain('if-no-files-found: error');
        expect(workflow).toContain('retention-days: 1');
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

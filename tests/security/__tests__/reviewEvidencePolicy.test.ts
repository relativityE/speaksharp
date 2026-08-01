import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    APPROVED_SCREENSHOT_UPLOADS,
    APPROVED_TEST_BINARY_FIXTURES,
    LEGACY_COMMITTED_REVIEW_BINARIES,
    committedReviewBinaries,
    inventoryArtifactUploads,
    playwrightConfigFiles,
    reviewEvidencePolicyViolations,
    scanArtifactUpload,
} from '../../../scripts/check-review-evidence-policy.mjs';

const repoRoot = resolve('.');
const temporaryRepos: string[] = [];

function policyFixtureRepo(): string {
    const fixture = mkdtempSync(join(tmpdir(), 'speaksharp-review-evidence-policy-'));
    temporaryRepos.push(fixture);
    cpSync(join(repoRoot, '.github', 'workflows'), join(fixture, '.github', 'workflows'), { recursive: true });
    for (const config of playwrightConfigFiles(repoRoot)) {
        cpSync(join(repoRoot, config), join(fixture, config));
    }
    for (const binary of LEGACY_COMMITTED_REVIEW_BINARIES) {
        const target = join(fixture, binary);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, 'historical evidence placeholder');
    }
    execFileSync('git', ['init', '--quiet'], { cwd: fixture });
    execFileSync('git', ['add', '.'], { cwd: fixture });
    return fixture;
}

function replaceInFixture(fixture: string, path: string, before: string, after: string): void {
    const target = join(fixture, path);
    const contents = readFileSync(target, 'utf8');
    expect(contents).toContain(before);
    writeFileSync(target, contents.replace(before, after));
}

afterEach(() => {
    for (const fixture of temporaryRepos.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

describe('#1132 ephemeral review-evidence policy', () => {
    it('inventories every upload and enforces the repository policy', () => {
        const inventory = inventoryArtifactUploads();

        expect(inventory.length).toBeGreaterThan(40);
        expect(new Set(inventory.map(({ key }) => key)).size).toBe(inventory.length);
        expect(inventory.every(({ workflow, name, paths, retentionDays }) =>
            workflow && name && paths.length > 0 && retentionDays)).toBe(true);
        expect(reviewEvidencePolicyViolations()).toEqual([]);

        const stress = inventory.find(({ key }) => key === 'stress-endurance.yml::stress-endurance-results');
        expect(stress?.paths).toEqual([
            'test-results/stress/backend-stress.latest.json',
            'test-results/endurance/browser-endurance.latest.json',
        ]);

        const proStt = inventory.find(({ key }) => key === 'pro-stt-artifact-matrix.yml::pro-stt-artifact-matrix-artifacts');
        expect(proStt?.paths).toEqual(['test-results/live/pro-stt-artifact-matrix-evidence.jsonl']);
        const proSttSpec = readFileSync(join(repoRoot, 'tests/live/pro-stt-artifact-matrix.live.spec.ts'), 'utf8');
        expect(proSttSpec).not.toContain("testInfo.attach('session-pdf'");
        expect(proSttSpec).toContain('rm(artifactPath, { force: true })');
        expect(proSttSpec).toContain('download.delete()');
    });

    it('limits approved screenshot uploaders to PNG-only one-day artifacts', () => {
        const screenshotUploads = inventoryArtifactUploads().filter(({ name, paths }) =>
            /screenshot/i.test(name ?? '') || paths.some((path) => /\.png(?:$|\b)/i.test(path)));

        expect(new Set(screenshotUploads.map(({ key }) => key))).toEqual(APPROVED_SCREENSHOT_UPLOADS);
        expect(screenshotUploads.every(({ retentionDays }) => retentionDays === '1')).toBe(true);
        expect(screenshotUploads.every(({ paths }) => paths.every((path) => /\.png(?:$|\b)/i.test(path)))).toBe(true);
    });

    it('freezes legacy committed review binaries without authorizing deletion or additions', () => {
        expect(new Set(committedReviewBinaries())).toEqual(new Set([
            ...LEGACY_COMMITTED_REVIEW_BINARIES,
            ...APPROVED_TEST_BINARY_FIXTURES,
        ]));
    });

    it('discovers every tracked Playwright config and keeps the demo recorder local-only', () => {
        expect(playwrightConfigFiles()).toContain('playwright.demo.config.ts');

        const fixture = policyFixtureRepo();
        const newConfig = join(fixture, 'playwright.new-review.config.ts');
        writeFileSync(newConfig, "export default { use: { screenshot: 'on', video: 'off', trace: 'off' } };\n");
        execFileSync('git', ['add', 'playwright.new-review.config.ts'], { cwd: fixture });
        expect(reviewEvidencePolicyViolations(fixture)).toContainEqual(
            expect.stringContaining('automated screenshot capture must be off'),
        );

        const workflowUse = policyFixtureRepo();
        replaceInFixture(
            workflowUse,
            '.github/workflows/review-evidence.yml',
            '          mkdir -p evidence',
            '          pnpm exec playwright test --config=playwright.demo.config.ts\n          mkdir -p evidence',
        );
        expect(reviewEvidencePolicyViolations(workflowUse)).toContainEqual(
            expect.stringContaining('local-only media config must never be invoked by Actions'),
        );
    });

    it('fails closed on missing or greater screenshot retention', () => {
        const missing = policyFixtureRepo();
        replaceInFixture(missing, '.github/workflows/review-evidence.yml', '          retention-days: 1\n', '');
        expect(reviewEvidencePolicyViolations(missing)).toEqual(expect.arrayContaining([
            expect.stringContaining('retention-days is required'),
            expect.stringContaining('screenshot retention must be exactly one day'),
        ]));

        const greater = policyFixtureRepo();
        replaceInFixture(
            greater,
            '.github/workflows/review-evidence.yml',
            '          retention-days: 1',
            '          retention-days: 2',
        );
        expect(reviewEvidencePolicyViolations(greater)).toContainEqual(
            expect.stringContaining('screenshot retention must be exactly one day'),
        );
    });

    it('rejects custom archives and unauthorized browser/session media', () => {
        const archive = policyFixtureRepo();
        replaceInFixture(
            archive,
            '.github/workflows/review-evidence.yml',
            '          mkdir -p evidence',
            '          zip evidence.zip evidence/*.png\n          mkdir -p evidence',
        );
        expect(reviewEvidencePolicyViolations(archive)).toContainEqual(
            expect.stringContaining('custom archive creation is forbidden'),
        );

        const trace = policyFixtureRepo();
        replaceInFixture(trace, 'playwright.config.ts', "trace: 'off'", "trace: 'retain-on-failure'");
        expect(reviewEvidencePolicyViolations(trace)).toContainEqual(
            expect.stringContaining('automated trace capture must be off'),
        );

        const exactPdf = policyFixtureRepo();
        replaceInFixture(
            exactPdf,
            '.github/workflows/review-evidence.yml',
            '      - name: Upload review evidence\n',
            "      - name: Upload exact PDF\n        if: always()\n        uses: actions/upload-artifact@v6\n        with:\n          name: proof\n          path: proof.pdf\n          retention-days: 1\n\n      - name: Upload review evidence\n",
        );
        expect(reviewEvidencePolicyViolations(exactPdf)).toContainEqual(
            expect.stringContaining('binary review artifact path is forbidden (proof.pdf)'),
        );
    });

    it('fails closed before broad browser-output upload when nested content is forbidden', () => {
        const fixture = policyFixtureRepo();
        const nestedScreenshot = join(fixture, 'test-results', 'soak', 'nested', 'auth-failure.png');
        mkdirSync(dirname(nestedScreenshot), { recursive: true });
        writeFileSync(nestedScreenshot, 'not uploaded');
        expect(scanArtifactUpload('v4-browser-proof.yml::v4-browser-proof', fixture)).toContainEqual(
            expect.stringContaining('forbidden browser/session artifact file'),
        );

        rmSync(nestedScreenshot);
        const nestedJson = join(fixture, 'playwright-report', 'nested', 'result.json');
        mkdirSync(dirname(nestedJson), { recursive: true });
        writeFileSync(nestedJson, JSON.stringify({ transcript: 'private practice words' }));
        expect(scanArtifactUpload('v4-browser-proof.yml::v4-browser-proof', fixture)).toContainEqual(
            expect.stringContaining('forbidden session or user content'),
        );

        expect(scanArtifactUpload('ci.yml::shard-report-1', fixture)).not.toContainEqual(
            expect.stringContaining('artifact uploader is not present'),
        );

        const disguisedBinary = join(fixture, 'playwright-report', 'proof.txt');
        writeFileSync(disguisedBinary, Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        expect(scanArtifactUpload('v4-browser-proof.yml::v4-browser-proof', fixture)).toContainEqual(
            expect.stringContaining('binary content in text artifact; upload denied'),
        );
        rmSync(disguisedBinary);

        const extensionlessBinary = join(fixture, 'playwright-report', 'disguised-proof');
        writeFileSync(extensionlessBinary, Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]));
        expect(scanArtifactUpload('v4-browser-proof.yml::v4-browser-proof', fixture)).toContainEqual(
            expect.stringContaining('binary content in text artifact; upload denied'),
        );
        rmSync(extensionlessBinary);

        const runnerTemp = mkdtempSync(join(tmpdir(), 'speaksharp-review-evidence-runner-temp-'));
        temporaryRepos.push(runnerTemp);
        writeFileSync(join(runnerTemp, 'v4-vite.log'), JSON.stringify({ transcript: 'private practice words' }));
        const previousRunnerTemp = process.env.RUNNER_TEMP;
        process.env.RUNNER_TEMP = runnerTemp;
        try {
            expect(scanArtifactUpload('v4-app-path-proof.yml::v4-app-path-proof', fixture)).toContainEqual(
                expect.stringContaining('forbidden session or user content'),
            );
        } finally {
            if (previousRunnerTemp === undefined) delete process.env.RUNNER_TEMP;
            else process.env.RUNNER_TEMP = previousRunnerTemp;
        }
    });

    it('rejects a broad browser-output uploader without both scanner and success guard', () => {
        const missingScanner = policyFixtureRepo();
        replaceInFixture(
            missingScanner,
            '.github/workflows/v4-browser-proof.yml',
            "      - name: Scan generated review evidence\n        id: review_evidence_scan\n        if: always()\n        run: node scripts/check-review-evidence-policy.mjs --scan-upload 'v4-browser-proof.yml::v4-browser-proof'\n\n",
            '',
        );
        expect(reviewEvidencePolicyViolations(missingScanner)).toContainEqual(
            expect.stringContaining('requires a fail-closed pre-upload scanner'),
        );

        const missingGuard = policyFixtureRepo();
        replaceInFixture(
            missingGuard,
            '.github/workflows/v4-browser-proof.yml',
            "if: ${{ always() && steps.review_evidence_scan.outcome == 'success' }}",
            'if: always()',
        );
        expect(reviewEvidencePolicyViolations(missingGuard)).toContainEqual(
            expect.stringContaining('upload must be blocked unless the pre-upload scanner succeeds'),
        );

        const neutralUploader = policyFixtureRepo();
        replaceInFixture(
            neutralUploader,
            '.github/workflows/review-evidence.yml',
            '      - name: Upload review evidence\n',
            "      - name: Upload neutral output\n        if: always()\n        uses: actions/upload-artifact@v6\n        with:\n          name: output\n          path: out/\n          retention-days: 1\n\n      - name: Upload review evidence\n",
        );
        expect(reviewEvidencePolicyViolations(neutralUploader)).toContainEqual(
            expect.stringContaining('review-evidence.yml::output: broad browser-output upload requires'),
        );

        const absoluteDirectory = policyFixtureRepo();
        replaceInFixture(
            absoluteDirectory,
            '.github/workflows/review-evidence.yml',
            '      - name: Upload review evidence\n',
            "      - name: Upload neutral absolute output\n        if: always()\n        uses: actions/upload-artifact@v6\n        with:\n          name: absolute-output\n          path: /tmp/neutral-review-output\n          retention-days: 30\n\n      - name: Upload review evidence\n",
        );
        expect(reviewEvidencePolicyViolations(absoluteDirectory)).toContainEqual(
            expect.stringContaining('review-evidence.yml::absolute-output: broad browser-output upload requires'),
        );

        const absoluteFile = policyFixtureRepo();
        replaceInFixture(
            absoluteFile,
            '.github/workflows/review-evidence.yml',
            '      - name: Upload review evidence\n',
            "      - name: Upload exact absolute result\n        if: always()\n        uses: actions/upload-artifact@v6\n        with:\n          name: absolute-result\n          path: /tmp/result.json\n          retention-days: 1\n\n      - name: Upload review evidence\n",
        );
        expect(reviewEvidencePolicyViolations(absoluteFile)).not.toContainEqual(
            expect.stringContaining('review-evidence.yml::absolute-result: broad browser-output upload requires'),
        );
    });

    it('fails closed for absolute, dynamic, and symlinked upload roots', () => {
        const absolute = policyFixtureRepo();
        const absoluteOutput = mkdtempSync(join(tmpdir(), 'speaksharp-review-evidence-absolute-'));
        temporaryRepos.push(absoluteOutput);
        writeFileSync(join(absoluteOutput, 'nested.png'), 'forbidden screenshot');
        replaceInFixture(
            absolute,
            '.github/workflows/v4-browser-proof.yml',
            '            playwright-report/',
            `            ${absoluteOutput}/`,
        );
        expect(scanArtifactUpload('v4-browser-proof.yml::v4-browser-proof', absolute)).toContainEqual(
            expect.stringContaining('forbidden browser/session artifact file'),
        );

        const dynamic = policyFixtureRepo();
        replaceInFixture(
            dynamic,
            '.github/workflows/v4-browser-proof.yml',
            '            playwright-report/',
            '            ${{ matrix.output_dir }}/',
        );
        expect(scanArtifactUpload('v4-browser-proof.yml::v4-browser-proof', dynamic)).toContainEqual(
            expect.stringContaining('unsupported dynamic upload path; upload denied'),
        );

        const symlinked = policyFixtureRepo();
        const symlinkTarget = join(symlinked, 'safe-target');
        mkdirSync(symlinkTarget);
        writeFileSync(join(symlinkTarget, 'result.json'), JSON.stringify({ passed: true }));
        symlinkSync(symlinkTarget, join(symlinked, 'review-link'));
        replaceInFixture(
            symlinked,
            '.github/workflows/v4-browser-proof.yml',
            '            playwright-report/',
            '            review-link/',
        );
        expect(scanArtifactUpload('v4-browser-proof.yml::v4-browser-proof', symlinked)).toContainEqual(
            expect.stringContaining('symbolic links are forbidden'),
        );
    });

    it('distinguishes nonexistent upload roots from valid empty and exact-text roots', () => {
        const missingRelative = policyFixtureRepo();
        replaceInFixture(
            missingRelative,
            '.github/workflows/review-evidence.yml',
            '          path: evidence/*.png',
            '          path: missing-review-output/',
        );
        expect(scanArtifactUpload(
            'review-evidence.yml::pr${{ github.event.inputs.pr }}-${{ github.event.inputs.reviewed_sha }}-mode-selector-screenshots',
            missingRelative,
        )).toContainEqual(expect.stringContaining('configured upload path does not exist; upload denied'));

        const missingAbsolute = policyFixtureRepo();
        const missingAbsoluteRoot = join(missingAbsolute, 'never-created-review-output');
        replaceInFixture(
            missingAbsolute,
            '.github/workflows/review-evidence.yml',
            '          path: evidence/*.png',
            `          path: ${missingAbsoluteRoot}/`,
        );
        expect(scanArtifactUpload(
            'review-evidence.yml::pr${{ github.event.inputs.pr }}-${{ github.event.inputs.reviewed_sha }}-mode-selector-screenshots',
            missingAbsolute,
        )).toContainEqual(expect.stringContaining('configured upload path does not exist; upload denied'));

        const emptyExisting = policyFixtureRepo();
        mkdirSync(join(emptyExisting, 'empty-review-output'));
        replaceInFixture(
            emptyExisting,
            '.github/workflows/review-evidence.yml',
            '          path: evidence/*.png',
            '          path: empty-review-output/',
        );
        // An existing empty directory is resolved and fully scanned. Whether an
        // empty upload is accepted remains the upload step's if-no-files-found policy.
        expect(scanArtifactUpload(
            'review-evidence.yml::pr${{ github.event.inputs.pr }}-${{ github.event.inputs.reviewed_sha }}-mode-selector-screenshots',
            emptyExisting,
        )).toEqual([]);

        const exactText = policyFixtureRepo();
        writeFileSync(join(exactText, 'exact-result.json'), JSON.stringify({ passed: true }));
        replaceInFixture(
            exactText,
            '.github/workflows/review-evidence.yml',
            '      - name: Upload review evidence\n',
            "      - name: Upload exact text result\n        uses: actions/upload-artifact@v6\n        with:\n          name: exact-text-result\n          path: exact-result.json\n          retention-days: 1\n\n      - name: Upload review evidence\n",
        );
        expect(scanArtifactUpload('review-evidence.yml::exact-text-result', exactText)).toEqual([]);

        writeFileSync(join(exactText, 'HEALTH_PASSED'), 'health-check completed\n');
        replaceInFixture(
            exactText,
            '.github/workflows/review-evidence.yml',
            '      - name: Upload review evidence\n',
            "      - name: Upload exact marker\n        uses: actions/upload-artifact@v6\n        with:\n          name: exact-marker\n          path: HEALTH_PASSED\n          retention-days: 1\n\n      - name: Upload review evidence\n",
        );
        expect(scanArtifactUpload('review-evidence.yml::exact-marker', exactText)).toEqual([]);
    });

    it('rejects newly committed review binaries outside named evidence directories', () => {
        const fixture = policyFixtureRepo();
        const binaryEvidence: Array<[string, Uint8Array]> = [
            ['docs/new-review.png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47])],
            ['review-output/proof.zip', Uint8Array.from([0x50, 0x4b, 0x03, 0x04])],
            ['docs/review-shot.gif', Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])],
            ['docs/proof.pdf', Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d])],
            ['docs/interview.wav', Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0])],
            ['docs/extensionless-proof', Uint8Array.from([0, 0xff, 0x01, 0xfe])],
        ];
        for (const [path, contents] of binaryEvidence) {
            const added = join(fixture, path);
            mkdirSync(dirname(added), { recursive: true });
            writeFileSync(added, contents);
            execFileSync('git', ['add', path], { cwd: fixture });
        }

        const violations = reviewEvidencePolicyViolations(fixture);
        for (const [path] of binaryEvidence) {
            expect(violations).toContainEqual(
                expect.stringContaining(`${path}: committed binary review evidence is forbidden`),
            );
        }

        const productAsset = join(fixture, 'frontend/public/assets/new-product-icon.png');
        mkdirSync(dirname(productAsset), { recursive: true });
        writeFileSync(productAsset, 'approved product asset root');
        execFileSync('git', ['add', 'frontend/public/assets/new-product-icon.png'], { cwd: fixture });
        expect(reviewEvidencePolicyViolations(fixture)).not.toContainEqual(
            expect.stringContaining('frontend/public/assets/new-product-icon.png'),
        );
    });
});

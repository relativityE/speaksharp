import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    APPROVED_SCREENSHOT_UPLOADS,
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
    });

    it('limits approved screenshot uploaders to PNG-only one-day artifacts', () => {
        const screenshotUploads = inventoryArtifactUploads().filter(({ name, paths }) =>
            /screenshot/i.test(name ?? '') || paths.some((path) => /\.png(?:$|\b)/i.test(path)));

        expect(new Set(screenshotUploads.map(({ key }) => key))).toEqual(APPROVED_SCREENSHOT_UPLOADS);
        expect(screenshotUploads.every(({ retentionDays }) => retentionDays === '1')).toBe(true);
        expect(screenshotUploads.every(({ paths }) => paths.every((path) => /\.png(?:$|\b)/i.test(path)))).toBe(true);
    });

    it('freezes legacy committed review binaries without authorizing deletion or additions', () => {
        expect(new Set(committedReviewBinaries())).toEqual(LEGACY_COMMITTED_REVIEW_BINARIES);
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
    });

    it('rejects newly committed review binaries outside named evidence directories', () => {
        const fixture = policyFixtureRepo();
        for (const path of ['docs/new-review.png', 'review-output/proof.zip']) {
            const added = join(fixture, path);
            mkdirSync(dirname(added), { recursive: true });
            writeFileSync(added, 'new binary review evidence');
            execFileSync('git', ['add', path], { cwd: fixture });
        }

        const violations = reviewEvidencePolicyViolations(fixture);
        expect(violations).toEqual(expect.arrayContaining([
            expect.stringContaining('docs/new-review.png: committed binary review evidence is forbidden'),
            expect.stringContaining('review-output/proof.zip: committed binary review evidence is forbidden'),
        ]));

        const productAsset = join(fixture, 'frontend/public/assets/new-product-icon.png');
        mkdirSync(dirname(productAsset), { recursive: true });
        writeFileSync(productAsset, 'approved product asset root');
        execFileSync('git', ['add', 'frontend/public/assets/new-product-icon.png'], { cwd: fixture });
        expect(reviewEvidencePolicyViolations(fixture)).not.toContainEqual(
            expect.stringContaining('frontend/public/assets/new-product-icon.png'),
        );
    });
});

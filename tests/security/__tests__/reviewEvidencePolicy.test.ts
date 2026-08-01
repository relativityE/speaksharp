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
    reviewEvidencePolicyViolations,
} from '../../../scripts/check-review-evidence-policy.mjs';

const repoRoot = resolve('.');
const temporaryRepos: string[] = [];

function policyFixtureRepo(): string {
    const fixture = mkdtempSync(join(tmpdir(), 'speaksharp-review-evidence-policy-'));
    temporaryRepos.push(fixture);
    cpSync(join(repoRoot, '.github', 'workflows'), join(fixture, '.github', 'workflows'), { recursive: true });
    for (const config of [
        'playwright.base.config.ts',
        'playwright.config.ts',
        'playwright.live.config.ts',
        'playwright.deployed-live.config.ts',
        'playwright.canary.config.ts',
        'playwright.soak.config.ts',
        'playwright.stripe.config.ts',
    ]) {
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

    it('rejects newly committed binary review evidence', () => {
        const fixture = policyFixtureRepo();
        const added = join(fixture, 'docs/evidence/new-review.png');
        mkdirSync(dirname(added), { recursive: true });
        writeFileSync(added, 'new binary review evidence');
        execFileSync('git', ['add', 'docs/evidence/new-review.png'], { cwd: fixture });

        expect(reviewEvidencePolicyViolations(fixture)).toContainEqual(
            expect.stringContaining('committed binary review evidence is forbidden'),
        );
    });
});

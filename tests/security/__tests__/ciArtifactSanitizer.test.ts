import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    mergePlaywrightSummaries,
    sanitizeLighthouseDirectory,
    sanitizeLighthouseReports,
    sanitizePlaywrightFile,
    sanitizePlaywrightReport,
} from '../../../scripts/sanitize-ci-artifact.mjs';
import { aggregatePlaywright } from '../../../scripts/aggregate-playwright.mjs';
import { parseLighthouse, parsePlaywrightResults } from '../../../scripts/ci-telemetry-utils.mjs';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
    const directory = mkdtempSync(join(tmpdir(), 'speaksharp-ci-sanitizer-'));
    temporaryDirectories.push(directory);
    return directory;
}

function lighthouseReport() {
    const metric = { score: 0.9, numericValue: 123.4 };
    return {
        requestedUrl: 'https://person@example.com/private',
        categories: {
            performance: { score: 0.91, description: 'data:image/png;base64,forbidden' },
            accessibility: { score: 0.95 },
            'best-practices': { score: 0.88 },
            seo: { score: 0.93 },
        },
        audits: {
            'first-contentful-paint': metric,
            'largest-contentful-paint': metric,
            'speed-index': metric,
            'total-blocking-time': metric,
            'cumulative-layout-shift': metric,
            'final-screenshot': { details: { data: 'data:image/jpeg;base64,forbidden' } },
        },
    };
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('#1132 CI artifact sanitization', () => {
    it('allowlists Playwright metrics and excludes emails, identifiers, content, and embedded media', () => {
        const raw = {
            stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0, total: 1 },
            tests: [{
                id: 'account-550e8400-e29b-41d4-a716-446655440000',
                title: 'signs in person@example.com',
                status: 'passed',
                outcome: 'expected',
                retries: 0,
                duration: 25,
                retryOverheadMs: 0,
                attempts: 1,
                error: 'transcript: private words',
                attachments: [{ body: 'data:image/png;base64,forbidden' }],
            }],
        };

        const sanitized = sanitizePlaywrightReport(raw, 2);
        const serialized = JSON.stringify(sanitized);
        expect(sanitized).toEqual({
            schemaVersion: 1,
            kind: 'playwright-shard-summary',
            shard: 2,
            stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0, total: 1 },
            tests: [{
                status: 'passed',
                outcome: 'expected',
                retries: 0,
                duration: 25,
                retryOverheadMs: 0,
                attempts: 1,
            }],
        });
        expect(serialized).not.toMatch(/person@example\.com|550e8400|transcript|data:image|base64/i);
    });

    it('allowlists Lighthouse categories and metrics while excluding raw reports and screenshots', () => {
        const sanitized = sanitizeLighthouseReports([lighthouseReport()]);
        const serialized = JSON.stringify(sanitized);
        expect(sanitized.reports[0].categories).toEqual({
            performance: 0.91,
            accessibility: 0.95,
            bestPractices: 0.88,
            seo: 0.93,
        });
        expect(Object.keys(sanitized.reports[0].metrics)).toEqual([
            'first-contentful-paint',
            'largest-contentful-paint',
            'speed-index',
            'total-blocking-time',
            'cumulative-layout-shift',
        ]);
        expect(serialized).not.toMatch(/person@example\.com|requestedUrl|final-screenshot|data:image|base64/i);
    });

    it('removes stale output and fails closed when sanitization input is missing or malformed', () => {
        const directory = temporaryDirectory();
        const playwrightOutput = join(directory, 'playwright-summary.json');
        writeFileSync(playwrightOutput, '{"stale":true}\n');
        expect(() => sanitizePlaywrightFile(join(directory, 'missing.json'), playwrightOutput, 1)).toThrow(/missing/);
        expect(() => readFileSync(playwrightOutput, 'utf8')).toThrow();

        const lighthouseDirectory = join(directory, 'lighthouse');
        const lighthouseOutput = join(directory, 'lighthouse-summary.json');
        mkdirSync(lighthouseDirectory);
        writeFileSync(lighthouseOutput, '{"stale":true}\n');
        writeFileSync(join(lighthouseDirectory, 'invalid-report.json'), '{"categories":{}}\n');
        expect(() => sanitizeLighthouseDirectory(lighthouseDirectory, lighthouseOutput)).toThrow(/No valid Lighthouse/);
        expect(() => readFileSync(lighthouseOutput, 'utf8')).toThrow();
    });

    it('preserves aggregate CI counts and Lighthouse scores without restoring excluded fields', () => {
        const directory = temporaryDirectory();
        const first = sanitizePlaywrightReport({
            tests: [{ status: 'passed', outcome: 'expected', retries: 0, duration: 20, retryOverheadMs: 0, attempts: 1 }],
        }, 1);
        const second = sanitizePlaywrightReport({
            tests: [{ status: 'passed', outcome: 'flaky', retries: 1, duration: 35, retryOverheadMs: 10, attempts: 2 }],
        }, 2);
        const merged = mergePlaywrightSummaries([second, first]);
        const playwrightDirectory = join(directory, 'test-results', 'playwright');
        mkdirSync(playwrightDirectory, { recursive: true });
        const playwrightPath = join(playwrightDirectory, 'results.json');
        writeFileSync(playwrightPath, JSON.stringify(merged));

        expect(aggregatePlaywright(playwrightPath)).toMatchObject({
            totalDurationMs: 55,
            retryOverheadMs: 10,
            testCount: 2,
        });
        expect(parsePlaywrightResults(directory)).toMatchObject({
            passed: 1,
            flaky: 1,
            failed: 0,
            total: 2,
        });

        const lighthouseDirectory = join(directory, 'artifacts', 'lighthouse');
        mkdirSync(lighthouseDirectory, { recursive: true });
        writeFileSync(
            join(lighthouseDirectory, 'lighthouse-summary.json'),
            JSON.stringify(sanitizeLighthouseReports([lighthouseReport()])),
        );
        expect(parseLighthouse(directory)).toEqual({
            performance: 91,
            accessibility: 95,
            bestPractices: 88,
            seo: 93,
        });
    });
});

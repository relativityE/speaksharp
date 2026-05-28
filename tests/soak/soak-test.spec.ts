import { test, expect } from '@playwright/test';
import logger from '../../frontend/src/lib/logger';
import { SOAK_API_TEST_USERS, SOAK_CONFIG } from '../constants';
import * as fs from 'fs';
import { runApiLoadTest } from './backend-api-stress-test';
import { runFrontendMemCheck } from './frontend-ui-memcheck';

test.describe('Stress/Endurance Coordinator: Backend + Browser Evidence', () => {
    // Run sequentially: backend stress first, then browser endurance.
    // This file coordinates the two evidence paths while the individual
    // scripts write structured artifacts for release review.
    test.describe.configure({ mode: 'serial' });

    // Enforce CI-only execution to protect developer machines and live databases from accidental load
    // Stress/endurance checks are intensive; prefer GitHub Actions for release evidence.

    test.beforeAll(() => {
        // Ensure results directory exists
        if (!fs.existsSync(SOAK_CONFIG.RESULTS_DIR)) {
            fs.mkdirSync(SOAK_CONFIG.RESULTS_DIR, { recursive: true });
        }

        // Synergy: Log last benchmark date to provide context for STT accuracy observations
        try {
            const benchmarks = JSON.parse(fs.readFileSync('tests/STT_BENCHMARKS.json', 'utf-8'));
            const cloudHistory = benchmarks.engines.Cloud.history;
            if (cloudHistory && cloudHistory.length > 0) {
                const latest = cloudHistory[cloudHistory.length - 1];
                logger.info(`\n[SYNERGY] Last STT Benchmark: ${latest.timestamp} (Accuracy: ${latest.ceiling_accuracy_pct}%)`);
            }
        } catch {
            logger.warn(`\n[SYNERGY] Could not read STT_BENCHMARKS.json for context.`);
        }
    });



    // =========================================================================
    // PRONG 1: Backend Stress
    // =========================================================================
    test('Backend Stress: API path under concurrent users', async () => {
        // We override the default concurrency just for this specific headless test
        // 100 concurrent requests over the Thundering Herd phases
        const requestedConcurrency = parseInt(process.env.API_LOAD_CONCURRENCY || String(SOAK_API_TEST_USERS.length), 10);
        const API_CONCURRENCY = Math.min(requestedConcurrency, SOAK_API_TEST_USERS.length);

        logger.info(`\n=================================================`);
        logger.info(`[START] Phase 1 - Headless API Load (${API_CONCURRENCY} Users)`);
        logger.info(`=================================================\n`);

        const result = await runApiLoadTest(API_CONCURRENCY);

        expect(result.success).toBe(true);
        expect(result.authSuccess).toBe(API_CONCURRENCY);
        expect(result.edgeSuccess).toBe(API_CONCURRENCY);
        expect(result.rpcSuccess).toBe(API_CONCURRENCY);

        logger.info(`\n⭐ Phase 1 Complete. Moving to UI Memory Check.\n`);
    });

    // =========================================================================
    // PRONG 2: Browser Endurance
    // =========================================================================
    test('Browser Endurance: Native recording stability', async ({ browser }) => {
        logger.info(`\n=================================================`);
        logger.info(`[START] Phase 2 - Frontend UI Memory Check`);
        logger.info(`=================================================\n`);

        await runFrontendMemCheck(browser);

        logger.info(`\n⭐ Phase 2 Complete. Stress/endurance checks finished.\n`);
    });
});

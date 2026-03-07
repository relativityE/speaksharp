import { test, expect } from '@playwright/test';
import logger from '../../frontend/src/lib/logger';
import { SOAK_CONFIG } from '../constants';
import * as fs from 'fs';
import { runApiLoadTest } from './backend-api-stress-test';
import { runFrontendMemCheck } from './frontend-ui-memcheck';

test.describe('Soak Test Coordinator: Unified Dual Architecture', () => {
    // ⚠️ CRITICAL: Run tests sequentially. Execute the Backend Soak Test first, then the Frontend Soak Test.
    // This file serves strictly as a coordinator orchestrating the two distinct soak tests.
    test.describe.configure({ mode: 'serial' });

    // Enforce CI-only execution to protect developer machines and live databases from accidental load
    // Soak tests are intensive; ensure local machine has sufficient RAM when running.

    test.beforeAll(() => {
        // Ensure results directory exists
        if (!fs.existsSync(SOAK_CONFIG.RESULTS_DIR)) {
            fs.mkdirSync(SOAK_CONFIG.RESULTS_DIR, { recursive: true });
        }

        // Synergy: Log last benchmark date to provide context for STT accuracy observations
        try {
            const benchmarks = JSON.parse(fs.readFileSync('docs/STT_BENCHMARKS.json', 'utf-8'));
            const cloudHistory = benchmarks.engines.Cloud.history;
            if (cloudHistory && cloudHistory.length > 0) {
                const latest = cloudHistory[cloudHistory.length - 1];
                logger.info(`\n[SYNERGY] Last STT Benchmark: ${latest.timestamp} (Accuracy: ${latest.ceiling_accuracy_pct}%)`);
            }
        } catch (e) {
            logger.warn(`\n[SYNERGY] Could not read STT_BENCHMARKS.json for context.`);
        }
    });



    // =========================================================================
    // PRONG 1: Backend Soak Test
    // =========================================================================
    test('Backend Soak Test: API Stress (Headless)', async () => {
        // We override the default concurrency just for this specific headless test
        // 100 concurrent requests over the Thundering Herd phases
        const API_CONCURRENCY = parseInt(process.env.API_LOAD_CONCURRENCY || '100', 10);

        logger.info(`\n=================================================`);
        logger.info(`[START] Phase 1 - Headless API Load (${API_CONCURRENCY} Users)`);
        logger.info(`=================================================\n`);

        const result = await runApiLoadTest(API_CONCURRENCY);

        expect(result.success).toBe(true);
        expect(result.authSuccess).toBeGreaterThan(0);

        logger.info(`\n⭐ Phase 1 Complete. Moving to UI Memory Check.\n`);
    });

    // =========================================================================
    // PRONG 2: Frontend Soak Test
    // =========================================================================
    test('Frontend Soak Test: UI Memory Check (Real Browser)', async ({ browser }) => {
        logger.info(`\n=================================================`);
        logger.info(`[START] Phase 2 - Frontend UI Memory Check`);
        logger.info(`=================================================\n`);

        await runFrontendMemCheck(browser);

        logger.info(`\n⭐ Phase 2 Complete. Soak Test Finished.\n`);
    });
});



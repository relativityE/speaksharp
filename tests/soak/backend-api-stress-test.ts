import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'node:crypto';
import { SOAK_API_TEST_USERS } from '../constants';

// Load environment variables. In Playwright/Soak context, we target .env.development (Dynamic in Cloud).
const envPath = path.resolve(process.cwd(), '.env.development');
dotenv.config({ path: fs.existsSync(envPath) ? envPath : undefined });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const CONCURRENCY = SOAK_API_TEST_USERS.length;
const STRESS_RESULTS_DIR = path.resolve(process.cwd(), 'test-results/stress');
const STRESS_EVIDENCE_PATH = path.join(STRESS_RESULTS_DIR, 'backend-stress.latest.json');

export interface LoadTestResult {
    success: boolean;
    authSuccess: number;
    rpcSuccess: number;
    edgeSuccess: number;
}

type PhaseEvidence = {
    name: 'auth' | 'usage-edge' | 'session-rpc';
    total: number;
    success: number;
    failure: number;
    durationMs: number;
    p50Ms: number | null;
    p95Ms: number | null;
    errors: string[];
};

function percentile(values: number[], p: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[index];
}

function summarizePhase(
    name: PhaseEvidence['name'],
    total: number,
    success: number,
    durationMs: number,
    latencies: number[],
    errors: string[]
): PhaseEvidence {
    return {
        name,
        total,
        success,
        failure: Math.max(0, total - success),
        durationMs,
        p50Ms: percentile(latencies, 50),
        p95Ms: percentile(latencies, 95),
        errors: errors.slice(0, 5),
    };
}

function writeBackendStressEvidence(report: {
    status: 'pass' | 'fail';
    concurrency: number;
    startedAt: string;
    completedAt: string;
    totalDurationMs: number;
    throughputOpsPerSecond: number;
    phases: PhaseEvidence[];
    error?: string;
}) {
    fs.mkdirSync(STRESS_RESULTS_DIR, { recursive: true });
    fs.writeFileSync(STRESS_EVIDENCE_PATH, JSON.stringify({
        schemaVersion: 1,
        kind: 'backend-stress',
        run: {
            githubRunId: process.env.GITHUB_RUN_ID ?? null,
            githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
            commitSha: process.env.GITHUB_SHA ?? null,
            actor: process.env.GITHUB_ACTOR ?? null,
        },
        ...report,
    }, null, 2));
    console.log(`📄 Backend stress evidence written to ${STRESS_EVIDENCE_PATH}`);
}

export async function runApiLoadTest(concurrencyOverride?: number): Promise<LoadTestResult> {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        throw new Error('❌ Missing Supabase environment variables. Cannot run API Load Test.');
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });

    const actualConcurrency = Math.min(concurrencyOverride || CONCURRENCY, SOAK_API_TEST_USERS.length);
    const selectedUsers = SOAK_API_TEST_USERS.slice(0, actualConcurrency);
    console.log(`\n🚀 Starting Headless API Load Test (${actualConcurrency} Concurrent Users)`);
    console.log(`   Scope: auth login -> check-usage-limit Edge Function -> current session-save RPC`);
    console.log(`=================================================================\n`);

    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const tokens: string[] = [];
    const phases: PhaseEvidence[] = [];

    // ----------------------------------------------------------------------
    // PHASE 1: Thundering Herd Auth
    // ----------------------------------------------------------------------
    console.log(`[Phase 1] Attempting ${actualConcurrency} concurrent Supabase Auth logins...`);
    const phase1Start = Date.now();

    const authPromises = selectedUsers.map(async (user) => {
        const requestStart = Date.now();
        const result = await supabaseAdmin.auth.signInWithPassword({
            email: user.email,
            password: user.password,
        });
        return { user, result, latencyMs: Date.now() - requestStart };
    });

    const authResults = await Promise.allSettled(authPromises);
    const authSuccess = authResults.filter(r => r.status === 'fulfilled' && !r.value.result.error).length;
    const authLatencies: number[] = [];
    const authErrors: string[] = [];

    authResults.forEach((r, i) => {
        if (r.status === 'fulfilled') {
            authLatencies.push(r.value.latencyMs);
            if (r.value.result.data.session) {
                tokens.push(r.value.result.data.session.access_token);
            } else if (r.value.result.error) {
                const message = `Auth failed for ${r.value.user.email}: ${r.value.result.error.message}`;
                authErrors.push(message);
                console.error(`❌ ${message}`);
            }
        } else {
            const message = `Auth promise rejected for ${selectedUsers[i]?.email ?? `user ${i}`}: ${r.reason}`;
            authErrors.push(message);
            console.error(`❌ ${message}`);
        }
    });

    const phase1Duration = Date.now() - phase1Start;
    phases.push(summarizePhase('auth', actualConcurrency, authSuccess, phase1Duration, authLatencies, authErrors));
    console.log(`✅ Phase 1 Complete in ${phase1Duration}ms: ${authSuccess}/${actualConcurrency} logins successful.\n`);

    if (authSuccess !== actualConcurrency) {
        const message = `❌ Auth phase failed: ${authSuccess}/${actualConcurrency} users logged in. Stress users are not provisioned or credentials drifted.`;
        writeBackendStressEvidence({
            status: 'fail',
            concurrency: actualConcurrency,
            startedAt,
            completedAt: new Date().toISOString(),
            totalDurationMs: Date.now() - startTime,
            throughputOpsPerSecond: 0,
            phases,
            error: message,
        });
        throw new Error(message);
    }

    // ----------------------------------------------------------------------
    // PHASE 2: Edge Function Cold-Start & Overload
    // ----------------------------------------------------------------------
    console.log(`[Phase 2] Firing ${tokens.length} concurrent requests to 'check-usage-limit' Edge Function...`);
    const phase2Start = Date.now();

    const edgePromises = tokens.map(async (token) => {
        const requestStart = Date.now();
        const result = await supabaseAdmin.functions.invoke('check-usage-limit', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        return { result, latencyMs: Date.now() - requestStart };
    });

    const edgeResults = await Promise.allSettled(edgePromises);
    const edgeSuccess = edgeResults.filter(r =>
        r.status === 'fulfilled' && !r.value.result.error
    ).length;
    const edgeLatencies: number[] = [];
    const edgeErrors: string[] = [];

    edgeResults.forEach((r, idx) => {
        if (r.status === 'fulfilled') {
            edgeLatencies.push(r.value.latencyMs);
        }
        if (r.status === 'fulfilled' && r.value.result.error) {
            edgeErrors.push(String(r.value.result.error.message ?? r.value.result.error));
            if (idx === 0) {
                console.error(`   ❌ Phase 2 Sample Error (User ${idx}):`, r.value.result.error);
                // Also log the data if available to see internal error messages
                if (r.value.result.data) console.error(`   📝 Response Data:`, JSON.stringify(r.value.result.data));
            }
        } else if (r.status === 'rejected') {
            edgeErrors.push(String(r.reason));
        }
    });

    const phase2Duration = Date.now() - phase2Start;
    phases.push(summarizePhase('usage-edge', tokens.length, edgeSuccess, phase2Duration, edgeLatencies, edgeErrors));
    console.log(`✅ Phase 2 Complete in ${phase2Duration}ms: ${edgeSuccess}/${tokens.length} requests returned 200 OK.\n`);

    if (edgeSuccess !== tokens.length) {
        const message = `❌ Edge phase failed: ${edgeSuccess}/${tokens.length} check-usage-limit requests succeeded.`;
        writeBackendStressEvidence({
            status: 'fail',
            concurrency: actualConcurrency,
            startedAt,
            completedAt: new Date().toISOString(),
            totalDurationMs: Date.now() - startTime,
            throughputOpsPerSecond: 0,
            phases,
            error: message,
        });
        throw new Error(message);
    }

    // ----------------------------------------------------------------------
    // PHASE 3: Database RPC Locking
    // ----------------------------------------------------------------------
    console.log(`[Phase 3] Triggering ${tokens.length} concurrent 'create_session_and_update_usage' Postgres RPCs...`);
    const phase3Start = Date.now();

    // Create individual authenticated clients to simulate distinct users hitting the RPC
    const rpcPromises = tokens.map(async (token, idx) => {
        // Add 100ms jitter to prevent artificial rate-limit spikes
        await new Promise(resolve => setTimeout(resolve, idx * 100));

        const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { persistSession: false }
        });

        const requestStart = Date.now();
        const result = await client.rpc('create_session_and_update_usage', {
            p_session_data: {
                title: `Stress Test Session ${Date.now()}`,
                duration: 60,
                total_words: 150,
                filler_words: { "um": 2, "uh": 1 },
                accuracy: 94.5,
                ground_truth: "This is a stress test transcript to verify database resilience under concurrent load.",
                transcript: "This is a stress test transcript to verify database resilience under concurrent load.",
                engine: "native",
                clarity_score: 85.5,
                wpm: 140.2
            },
            p_engine_type: "native",
            p_idempotency_key: randomUUID(),
            p_engine_version: "web-speech-api",
            p_model_name: "browser-native",
            p_device_type: "browser"
        });
        return { result, latencyMs: Date.now() - requestStart };
    });

    const rpcResults = await Promise.allSettled(rpcPromises);
    let rpcSuccess = 0;
    const rpcLatencies: number[] = [];
    const rpcErrors: string[] = [];

    rpcResults.forEach((r, idx) => {
        if (r.status === 'fulfilled') {
            rpcLatencies.push(r.value.latencyMs);
        }
        if (r.status === 'fulfilled' && !r.value.result.error) {
            rpcSuccess++;
        } else if (r.status === 'fulfilled' && r.value.result.error) {
            rpcErrors.push(r.value.result.error.message);
            if (idx === 0) {
                console.error(`   ❌ Phase 3 Sample Error (User ${idx}):`, r.value.result.error.message);
                if (r.value.result.error.details) console.error(`   📝 Details:`, r.value.result.error.details);
                if (r.value.result.error.hint) console.error(`   💡 Hint:`, r.value.result.error.hint);
            }
        } else if (r.status === 'rejected') {
            rpcErrors.push(String(r.reason));
        }
    });

    const phase3Duration = Date.now() - phase3Start;
    phases.push(summarizePhase('session-rpc', tokens.length, rpcSuccess, phase3Duration, rpcLatencies, rpcErrors));
    console.log(`✅ Phase 3 Complete in ${phase3Duration}ms: ${rpcSuccess}/${tokens.length} database row insertions successful.\n`);

    if (rpcSuccess !== tokens.length) {
        const message = `❌ RPC phase failed: ${rpcSuccess}/${tokens.length} session-save RPCs succeeded.`;
        writeBackendStressEvidence({
            status: 'fail',
            concurrency: actualConcurrency,
            startedAt,
            completedAt: new Date().toISOString(),
            totalDurationMs: Date.now() - startTime,
            throughputOpsPerSecond: 0,
            phases,
            error: message,
        });
        throw new Error(message);
    }

    // ----------------------------------------------------------------------
    // FINISH
    // ----------------------------------------------------------------------
    const totalDurationMs = Date.now() - startTime;
    const totalDuration = (totalDurationMs / 1000).toFixed(2);
    const totalOps = actualConcurrency + tokens.length + tokens.length;
    const throughputOpsPerSecond = Number((totalOps / (totalDurationMs / 1000)).toFixed(2));
    console.log(`🏁 API Load Test Finished in ${totalDuration} seconds.`);
    writeBackendStressEvidence({
        status: 'pass',
        concurrency: actualConcurrency,
        startedAt,
        completedAt: new Date().toISOString(),
        totalDurationMs,
        throughputOpsPerSecond,
        phases,
    });

    return { success: true, authSuccess, rpcSuccess, edgeSuccess };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const requestedConcurrency = process.env.API_LOAD_CONCURRENCY
        ? parseInt(process.env.API_LOAD_CONCURRENCY, 10)
        : undefined;

    runApiLoadTest(requestedConcurrency).catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}

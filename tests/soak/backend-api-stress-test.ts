import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import WebSocket from 'ws';

// Load environment variables (assuming running via Vitest or TS-Node)
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY || '';

// Force the number of concurrent users here for the Thundering Herd
// NOTE: We cap this at 10 because the cloud test user provisioning is set to 10 accounts.
const CONCURRENCY = 10;
const WS_CONCURRENCY = 5; // Fixed at 5 to respect Free Tier Limits

export interface LoadTestResult {
    success: boolean;
    authSuccess: number;
    rpcSuccess: number;
    edgeSuccess: number;
    wsConnected: number;
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

    const actualConcurrency = concurrencyOverride || CONCURRENCY;
    console.log(`\n🚀 Starting Headless API Load Test (${actualConcurrency} Concurrent Users)`);
    console.log(`=================================================================\n`);

    const startTime = Date.now();
    const tokens: string[] = [];

    // ----------------------------------------------------------------------
    // PHASE 1: Thundering Herd Auth
    // ----------------------------------------------------------------------
    console.log(`[Phase 1] Attempting ${actualConcurrency} concurrent Supabase Auth logins...`);
    const phase1Start = Date.now();

    // Create an array of identical login promises (using a known soak test user)
    // In a real scenario, you'd use SOAK_TEST_USERS from constants.ts, but for a 
    // pure API stress test, hammering the same account or iterating is fine.
    // We'll use the generic FREE soak user defined in our specs.
    const email = process.env.SOAK_TEST_EMAIL || 'soak-test0@test.com';
    const password = process.env.SOAK_TEST_PASSWORD || 'password123';

    const authPromises = Array.from({ length: actualConcurrency }).map((_, i) =>
        supabaseAdmin.auth.signInWithPassword({
            email: i === 0 ? email : `soak-test${i}@test.com`,
            password: password,
        })
    );

    const authResults = await Promise.allSettled(authPromises);
    const authSuccess = authResults.filter(r => r.status === 'fulfilled' && !r.value.error).length;

    authResults.forEach((r, i) => {
        if (r.status === 'fulfilled') {
            if (r.value.data.session) {
                tokens.push(r.value.data.session.access_token);
            } else if (r.value.error) {
                console.error(`❌ Auth failed for user ${i}:`, r.value.error.message);
            }
        } else {
            console.error(`❌ Promise rejected for user ${i}:`, r.reason);
        }
    });

    console.log(`✅ Phase 1 Complete in ${Date.now() - phase1Start}ms: ${authSuccess}/${actualConcurrency} logins successful.\n`);

    if (tokens.length === 0) {
        console.error('❌ Authentication failed completely. Cannot proceed to API tests.');
        process.exit(1);
    }

    // ----------------------------------------------------------------------
    // PHASE 2: Edge Function Cold-Start & Overload
    // ----------------------------------------------------------------------
    console.log(`[Phase 2] Firing ${tokens.length} concurrent requests to 'check-usage-limit' Edge Function...`);
    const phase2Start = Date.now();

    const edgePromises = tokens.map(token =>
        supabaseAdmin.functions.invoke('check-usage-limit', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        })
    );

    const edgeResults = await Promise.allSettled(edgePromises);
    const edgeSuccess = edgeResults.filter(r =>
        r.status === 'fulfilled' && !r.value.error
    ).length;

    edgeResults.forEach((r, idx) => {
        if (r.status === 'fulfilled' && r.value.error) {
            if (idx === 0) {
                console.error(`   ❌ Phase 2 Sample Error (User ${idx}):`, r.value.error);
                // Also log the data if available to see internal error messages
                if (r.value.data) console.error(`   📝 Response Data:`, JSON.stringify(r.value.data));
            }
        }
    });

    console.log(`✅ Phase 2 Complete in ${Date.now() - phase2Start}ms: ${edgeSuccess}/${tokens.length} requests returned 200 OK.\n`);

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

        return client.rpc('create_session_and_update_usage', {
            p_is_free_user: true,
            p_session_data: {
                title: `Soak Test Session ${Date.now()}`,
                duration: 60,
                total_words: 150,
                filler_words: { "um": 2, "uh": 1 },
                accuracy: 94.5,
                ground_truth: "This is a stress test transcript to verify database resilience under concurrent load.",
                transcript: "This is a stress test transcript to verify database resilience under concurrent load.",
                engine: "whisper-turbo",
                clarity_score: 85.5,
                wpm: 140.2
            }
        });
    });

    const rpcResults = await Promise.allSettled(rpcPromises);
    let rpcSuccess = 0;

    rpcResults.forEach((r, idx) => {
        if (r.status === 'fulfilled' && !r.value.error) {
            rpcSuccess++;
        } else if (r.status === 'fulfilled' && r.value.error) {
            if (idx === 0) {
                console.error(`   ❌ Phase 3 Sample Error (User ${idx}):`, r.value.error.message);
                if (r.value.error.details) console.error(`   📝 Details:`, r.value.error.details);
                if (r.value.error.hint) console.error(`   💡 Hint:`, r.value.error.hint);
            }
        }
    });

    console.log(`✅ Phase 3 Complete in ${Date.now() - phase3Start}ms: ${rpcSuccess}/${tokens.length} database row insertions successful.\n`);

    // ----------------------------------------------------------------------
    // PHASE 4: WebSocket Free Tier Connections
    // ----------------------------------------------------------------------
    console.log(`[Phase 4] Opening ${WS_CONCURRENCY} concurrent WebSockets to AssemblyAI...`);
    let wsConnected = 0; // Initialize wsConnected here
    if (!ASSEMBLYAI_API_KEY) {
        console.log(`⚠️ Skipping Phase 4: No ASSEMBLYAI_API_KEY provided.`);
    } else {
        const phase4Start = Date.now();


        const wsPromises = Array.from({ length: WS_CONCURRENCY }).map((_, idx) => {
            return new Promise<void>((resolve) => {
                // Exchange HTTP for a temporary WS token if necessary, or just use auth header based on implementation.
                // Assuming SpeakSharp's token exchange flow (which hits our Edge Function first)
                // For raw API stress test, we hit the Assembly endpoint directly if we have the key, just to test limits.
                const ws = new WebSocket(`wss://api.assemblyai.com/v2/realtime/ws?sample_rate=16000`, {
                    headers: { Authorization: ASSEMBLYAI_API_KEY }
                });

                const timeout = setTimeout(() => {
                    ws.close();
                    resolve();
                }, 5000); // 5 second connection timeout

                ws.on('open', () => {
                    wsConnected++;
                    clearTimeout(timeout);
                    ws.send(JSON.stringify({ terminate_session: true })); // Immediately close cleanly
                    resolve();
                });

                ws.on('error', (err) => {
                    if (idx === 0) console.warn('   ⚠️ Note: First WebSocket failure reason:', err.message);
                    clearTimeout(timeout);
                    resolve();
                });
            });
        });

        await Promise.all(wsPromises);
        console.log(`✅ Phase 4 Complete in ${Date.now() - phase4Start}ms: ${wsConnected}/${WS_CONCURRENCY} sockets successfully established.\n`);
    }

    // ----------------------------------------------------------------------
    // FINISH
    // ----------------------------------------------------------------------
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`🏁 API Load Test Finished in ${totalDuration} seconds.`);

    if (authSuccess === 0) {
        throw new Error('❌ Test considered failed because zero initial auths succeeded.');
    }

    return { success: true, authSuccess, rpcSuccess, edgeSuccess, wsConnected };
}



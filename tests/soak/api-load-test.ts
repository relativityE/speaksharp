import { SOAK_CONFIG, SOAK_TEST_USERS, FREE_USER_COUNT, PRO_USER_COUNT } from '../constants';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment from .env.development
dotenv.config({ path: path.resolve(process.cwd(), '.env.development') });

/**
 * SpeakSharp API Soak Test - Node.js Implementation (Path B)
 * 
 * PURPOSE: Test backend capacity for 10 concurrent users over 5 minutes.
 * Isolated from browser/Vite/Hydration overhead.
 */

interface UserResult {
    success: boolean;
    userIndex: number;
    ops: number;
    error?: string;
    authDuration?: number;
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || '';
const SOAK_TEST_PASSWORD = process.env.SOAK_TEST_PASSWORD || 'password123';

const TEST_USER_COUNTS = {
    free: FREE_USER_COUNT,
    pro: PRO_USER_COUNT
};

async function runUserJourney(userIndex: number): Promise<UserResult> {
    const user = SOAK_TEST_USERS[userIndex % SOAK_TEST_USERS.length];
    let ops = 0;

    try {
        // 1. Authentication Phase
        const authStart = Date.now();
        const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: user.email,
                password: SOAK_TEST_PASSWORD
            })
        });

        if (!authRes.ok) {
            const errorText = await authRes.text();
            throw new Error(`Auth failed (${authRes.status}): ${errorText}`);
        }

        const authData = await authRes.json();
        const token = authData.access_token;
        const authDuration = Date.now() - authStart;
        console.log(`[User ${userIndex}] 🔐 Auth successful in ${authDuration}ms`);

        // 2. Load User Profile (Metadata check)
        await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${token}`
            }
        });
        ops++;

        // 3. Create Practice Session
        const sessionRes = await fetch(`${SUPABASE_URL}/rest/v1/practice_sessions`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            },
            body: JSON.stringify({
                title: `API Soak Session - User ${userIndex}`,
                duration: 0,
                total_words: 0,
                filler_words: {},
                transcript: ''
            })
        });

        if (!sessionRes.ok) {
            throw new Error(`Session creation failed: ${sessionRes.status}`);
        }
        const sessionData = await sessionRes.json();
        const sessionId = Array.isArray(sessionData) ? sessionData[0].id : sessionData.id;
        console.log(`[User ${userIndex}] 📝 Session created: ${sessionId}`);
        ops++;

        // 4. Steady State: Simulate 5 minutes of transcription activity
        const testEndTime = Date.now() + SOAK_CONFIG.SESSION_DURATION_MS;
        let iteration = 0;

        while (Date.now() < testEndTime) {
            iteration++;

            // Simulate transcription chunk update
            const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/practice_sessions?id=eq.${sessionId}`, {
                method: 'PATCH',
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    duration: iteration * 3,
                    total_words: iteration * 50,
                    transcript: `Simulated transcript chunk ${iteration}...`,
                    filler_words: { um: Math.floor(Math.random() * 5) }
                })
            });

            if (updateRes.ok) {
                ops++;
            } else {
                console.warn(`[User ${userIndex}] ⚠️ Patch failed: ${updateRes.status}`);
            }

            // Realistic "thinking" pause between chunks (3-5s)
            await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
        }

        console.log(`[User ${userIndex}] 🏁 Finished journey. Completed ${ops} API operations.`);
        return { success: true, userIndex, ops, authDuration };

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[User ${userIndex}] ❌ FAILED: ${errorMessage}`);
        return { success: false, userIndex, ops, error: errorMessage };
    }
}

async function main() {
    console.log('═══════════════════════════════════════════════');
    console.log('        SPEAKSHARP API SOAK TEST (PATH B)');
    console.log('═══════════════════════════════════════════════');
    console.log(`Target Users:  ${SOAK_CONFIG.CONCURRENT_USERS} usage (${TEST_USER_COUNTS.free} Free, ${TEST_USER_COUNTS.pro} Pro)`);
    console.log(`Duration:      ${SOAK_CONFIG.SESSION_DURATION_MS / 1000 / 60} minutes`);
    console.log(`Endpoint:      ${SUPABASE_URL}`);
    console.log('───────────────────────────────────────────────\n');

    const startTime = Date.now();

    // Stagger starts slightly to avoid hammering the initial auth endpoint 
    const results = await Promise.all(
        Array.from({ length: SOAK_CONFIG.CONCURRENT_USERS }, async (_, i) => {
            await new Promise(resolve => setTimeout(resolve, i * 1000));
            return runUserJourney(i);
        })
    );

    const endTime = Date.now();
    const durationSec = (endTime - startTime) / 1000;
    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;
    const totalOps = results.reduce((acc, r) => acc + r.ops, 0);

    console.log('\n═══════════════════════════════════════════════');
    console.log('        SOAK TEST METRICS SUMMARY');
    console.log('═══════════════════════════════════════════════');
    console.log(`✅ Success Users:    ${successCount}/${SOAK_CONFIG.CONCURRENT_USERS}`);
    console.log(`❌ Failed Users:     ${failCount}`);
    console.log(`📊 Total API Ops:    ${totalOps}`);
    console.log(`⏱️  Total Duration:   ${durationSec.toFixed(1)}s`);
    console.log(`📈 Throughput:       ${(totalOps / durationSec).toFixed(2)} ops/sec`);
    console.log('═══════════════════════════════════════════════\n');

    process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('Fatal Error:', err);
    process.exit(1);
});

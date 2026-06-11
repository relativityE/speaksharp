import { SOAK_API_TEST_USERS } from '../constants';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.development') });

/**
 * Pre-flight Check: Verify Stress/Endurance Test User Credentials
 */
async function verify() {
    const baseUrl = process.env.VITE_SUPABASE_URL || '';
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY || '';
    const password = process.env.SOAK_TEST_PASSWORD || 'password123';

    console.log('🔍 Verifying stress/endurance test credentials...\n');
    let failCount = 0;

    for (const user of SOAK_API_TEST_USERS) {
        try {
            const res = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
                method: 'POST',
                headers: { 'apikey': anonKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: user.email, password })
            });

            if (res.ok) {
                console.log(`✅ ${user.email.padEnd(25)} | OK`);
            } else {
                console.error(`❌ ${user.email.padEnd(25)} | FAILED (${res.status})`);
                failCount++;
            }

        } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.error(`❌ ${user.email.padEnd(25)} | ERROR: ${errorMessage}`);
            failCount++;
        }
    }

    if (failCount > 0) {
        console.error('\n❌ Verification failed for one or more users.');
        console.error('👉 Please run the setup script to synchronize credentials:');
        console.error('   pnpm tsx scripts/setup-test-users.mjs');
        console.error('   (Note: clean up existing users if needed or check env vars)');
        process.exit(1);
    } else {
        console.log(`\n✅ All ${SOAK_API_TEST_USERS.length} stress/endurance test users verified. Ready for stress testing.`);
    }
}

verify();

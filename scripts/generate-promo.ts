import fetch from 'node-fetch';
import dotenv from 'dotenv';
import path from 'path';

// Load .env keys
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.development') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
// We try to use Service Key if available, otherwise Anon Key (which worked before security check)
const API_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !API_KEY) {
    console.error('❌ Missing VITE_SUPABASE_URL or API KEY.');
    process.exit(1);
}

interface PromoData {
    code: string;
    duration_minutes: number;
    max_uses: number;
}

async function main() {
    console.log(`Generating promo code via Edge Function...`);

    try {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/apply-promo/generate`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({})
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Edge Function Failed (${response.status}): ${errText}`);
        }

        const data = (await response.json()) as unknown as PromoData;

        console.log('✅ Promo Code Generated:');
        console.log('------------------------------------------------');
        console.log(`Code:     ${data.code}`);
        console.log(`Duration: ${data.duration_minutes} minutes`);
        console.log(`Max Uses: ${data.max_uses}`);
        console.log('------------------------------------------------');

    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('❌ Failed:', msg);
        process.exit(1);
    }
}

main();

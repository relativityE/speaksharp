import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.development') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function inspect() {
    console.log('Connecting to:', SUPABASE_URL);

    // Check user_profiles
    const { data: profiles, error } = await supabase
        .from('user_profiles')
        .select('id, subscription_status, promo_expires_at')
        .order('created_at', { ascending: false, nullsFirst: false }) // Assuming created_at exists, identifying new users?
        // Standard profiles often don't have created_at, they rely on auth.users.
        // Let's just get the last few entries if possible, or all (assuming low volume).
        .limit(5);

    if (error) {
        console.error('Error querying user_profiles:', error);
    } else {
        console.log('--- Latest User Profiles ---');
        console.table(profiles);
        if (profiles.length === 0) console.log('No profiles found.');
    }
}

inspect();

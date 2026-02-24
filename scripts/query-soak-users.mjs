import { createClient } from '@supabase/supabase-js';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as url from 'url';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env.development') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.development');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
});

async function main() {
    console.log('Fetching all users from Supabase...');

    let allUsers = [];
    let pageNum = 1;

    while (true) {
        const { data, error } = await supabase.auth.admin.listUsers({
            page: pageNum,
            perPage: 100
        });

        if (error) {
            console.error('Error fetching users:', error.message);
            process.exit(1);
        }

        const users = data?.users || [];
        allUsers = allUsers.concat(users);

        if (users.length < 100) break;
        pageNum++;
    }

    const soakUsers = allUsers.filter(u => u.email && u.email.includes('soak-test'));
    console.log(`Found ${soakUsers.length} soak test users.\n`);

    if (soakUsers.length === 0) return;

    const { data: profiles, error: profileError } = await supabase
        .from('user_profiles')
        .select('id, subscription_status')
        .in('id', soakUsers.map(u => u.id));

    if (profileError) {
        console.error('Error fetching profiles:', profileError.message);
    }

    const profileMap = new Map(profiles?.map(p => [p.id, p.subscription_status]) || []);

    const results = soakUsers.map(u => ({
        email: u.email,
        tier: profileMap.get(u.id) || 'unknown'
    })).sort((a, b) => {
        const aNum = parseInt(a.email.match(/\d+/) || '0', 10);
        const bNum = parseInt(b.email.match(/\d+/) || '0', 10);
        return aNum - bNum;
    });

    console.log('Email'.padEnd(25) + '| Tier');
    console.log('-'.repeat(40));
    results.forEach(r => {
        console.log(`${r.email.padEnd(25)} | ${r.tier}`);
    });
}

main();

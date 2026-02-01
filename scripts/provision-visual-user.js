import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const email = 'promo-fix-test-1@test.com';
const password = 'test-password';

async function provisionUser() {
    console.log(`Provisioning user: ${email}...`);

    // 1. Check if user exists (by listing users - requires service role)
    // supabase.auth.admin.listUsers() is pagination based.
    // Instead, try to signIn. If fail, create. If success, update password?
    // Admin commands are safer.

    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();

    if (listError) {
        console.error('Failed to list users:', listError);
        // Fallback: Try create, if fail, try update by email (not possible directly by email in admin API without ID, 
        // but create will fail if exists, then we assume exists).
    }

    const existingUser = users?.find(u => u.email === email);

    if (existingUser) {
        console.log(`User exists (ID: ${existingUser.id}). Updating password...`);
        const { error: updateError } = await supabase.auth.admin.updateUserById(
            existingUser.id,
            { password: password, email_confirm: true }
        );
        if (updateError) {
            console.error('Failed to update password:', updateError);
            process.exit(1);
        }
        console.log('Password updated successfully.');
    } else {
        console.log('User does not exist. Creating...');
        const { data, error: createError } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true
        });
        if (createError) {
            console.error('Failed to create user:', createError);
            process.exit(1);
        }
        console.log(`User created successfully (ID: ${data.user.id}).`);
    }
}

provisionUser().catch(e => {
    console.error(e);
    process.exit(1);
});

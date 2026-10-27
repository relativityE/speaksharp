#!/usr/bin/env node
/** Dedicated, create-only entrypoint. No dotenv, registry setup, password reset, file output or dispatch inputs. */
import { createClient } from '@supabase/supabase-js';
import { provisionCanaryCredential } from './lib/canaryAccountAdmin.mjs';

const blocked = reason => {
    console.log(JSON.stringify({ result: 'BLOCKED', purpose: 'throwaway_free', reason }));
    process.exitCode = 1;
};

async function main() {
    if (process.argv.length !== 2) return blocked('unexpected_cli_arguments');
    if (process.env.ACTION && process.env.ACTION !== 'create') return blocked('throwaway_requires_create');
    for (const name of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY']) {
        if (!process.env[name]?.trim()) return blocked(`missing_${name}`);
    }
    const options = { auth: { autoRefreshToken: false, persistSession: false } };
    const adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
    const outcome = await provisionCanaryCredential({
        adminClient,
        makeSignInClient: () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, options),
        purpose: 'throwaway_free', action: 'create',
        secrets: {
            THROWAWAY_TEST_EMAIL: process.env.THROWAWAY_TEST_EMAIL,
            THROWAWAY_TEST_PASSWORD: process.env.THROWAWAY_TEST_PASSWORD,
            // Read-only collision identifiers; never authenticate a maintained account.
            CANARY_TRIAL_EMAIL: process.env.CANARY_TRIAL_EMAIL,
            CANARY_PAID_EMAIL: process.env.CANARY_PAID_EMAIL,
            FREE_TEST_EMAIL: process.env.FREE_TEST_EMAIL,
        },
        inputs: {
            email: process.env.CREATE_USER_EMAIL,
            password: process.env.CREATE_USER_PASSWORD,
            tier: process.env.CREATE_USER_TIER,
            credentialsPresent: !!process.env.CREATE_INPUTS_PRESENT && process.env.CREATE_INPUTS_PRESENT !== 'false',
        },
    });
    // No identity, UID, password, key, token, profile payload or raw SDK error is printed.
    console.log(JSON.stringify({ result: outcome.result, purpose: 'throwaway_free', ...outcome.facts }));
    if (outcome.result !== 'CREATED') process.exitCode = 1;
}

main().catch(() => blocked('throwaway_admin_failed'));

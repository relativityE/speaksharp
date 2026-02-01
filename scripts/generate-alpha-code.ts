/**
 * Alpha Bypass Code Generator
 * 
 * Generates a random 7-digit numeric code for use in the 
 * SPEAKSHARP_ALPHA_UPGRADE flow.
 * 
 * Usage:
 * pnpm exec tsx scripts/generate-alpha-code.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH = path.resolve(__dirname, '../frontend/src/config/alpha-bypass.ts');

const generateAlphaCode = () => {
    // Generate a random number between 1,000,000 and 9,999,999
    const code = Math.floor(1000000 + Math.random() * 9000000).toString();

    console.log('\n🚀 Generated New Alpha Bypass Code:');
    console.log('-------------------------------');
    console.log(`\x1b[1m\x1b[32m${code}\x1b[0m`);
    console.log('-------------------------------');

    // 1. Automatically update the local frontend config (for E2E/Manual Preview)
    try {
        const configContent = `/**
 * Alpha Bypass Configuration
 * 
 * This code allows alpha testers to upgrade to Pro without using Stripe.
 * Use scripts/generate-alpha-code.ts to rotate this code.
 * 
 * Updated: ${new Date().toISOString()}
 */
export const ALPHA_BYPASS_CODE = "${code}";
`;
        fs.writeFileSync(CONFIG_PATH, configContent);
        console.log(`✅ Automatically updated: ${path.basename(CONFIG_PATH)}`);
    } catch (err) {
        console.error(`❌ Failed to update ${CONFIG_PATH}:`, err);
    }

    console.log('\nNext Steps:');
    console.log(`1. Cloud Deployment: Set this secret in Supabase Dashboard (Settings -> API -> Edge Function Secrets)`);
    console.log(`   OR via CLI: supabase secrets set ALPHA_BYPASS_CODE=${code}`);
    console.log(`2. Deploy Code: supabase functions deploy apply-promo\n`);
};

generateAlphaCode();

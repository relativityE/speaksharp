import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file
dotenv.config({ path: join(__dirname, '..', '.env') });
// Load .env.test file (fallback for CI/Test)
dotenv.config({ path: join(__dirname, '..', '.env.test') });

const readKeys = (relPath) => {
    const file = join(__dirname, '..', relPath);
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
};

// REQUIRED vars (env.required) gate the build. OPTIONAL vars (env.optional) only
// warn — they degrade gracefully at runtime (Stripe hidden, Sentry disabled), so
// a clean checkout can build without them.
const required = readKeys('env.required');
const optional = readKeys('env.optional');

const missingRequired = required.filter(key => !process.env[key]);
const missingOptional = optional.filter(key => !process.env[key]);

if (missingRequired.length > 0) {
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ BUILD FAILED: Missing Required Environment Variables');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.error('The following REQUIRED environment variables are not set:\n');
    missingRequired.forEach(v => console.error(`  • ${v}`));
    console.error('\nPlease ensure these are defined in your .env file.');
    console.error('See README.md for setup instructions.');
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    process.exit(1);
}

if (missingOptional.length > 0) {
    console.warn('\n⚠️  Optional environment variables not set (build continues):');
    missingOptional.forEach(v => console.warn(`  • ${v}`));
    console.warn('   Stripe absent → payment/upgrade surfaces hidden; Sentry absent → error monitoring disabled;');
    console.warn('   STT gates absent → Private-primary governed by PostHog + Cloud OFF (fail-closed launch posture).\n');
}

// #1120 S1 (PR #1155) — exact-"true" FAIL-CLOSED gates. Only the exact string "true" enables; unset is valid.
// Surfaces (a) a typo/invalid live posture — a value that LOOKS like an enable attempt but is not exactly
// "true" (which silently stays OFF), and (b) the launch posture of any gate that IS on, so an operator can
// confirm Cloud stays OFF for the invite-only launch. Reads the REAL configured values (process.env / .env*).
const EXACT_TRUE_GATES = [
    { key: 'VITE_CLOUD_STT_ENABLED', enables: 'client Cloud STT', launch: 'OFF' },
    { key: 'CLOUD_STT_ENABLED', enables: 'Edge Cloud STT', launch: 'OFF' },
    { key: 'VITE_STT_PRIVATE_PRIMARY_DISABLED', enables: 'hierarchy HARD-disable (Browser-default rollback)', launch: 'unset' },
    { key: 'VITE_PAYMENTS_ENABLED', enables: 'payments/checkout UI', launch: 'OFF' },
];
const looksLikeEnableAttempt = (v) =>
    v !== undefined && v.trim() !== '' && v !== 'true' && /^(true|1|yes|on)$/i.test(v.trim());
const enabledGates = [];
const misconfiguredGates = [];
for (const g of EXACT_TRUE_GATES) {
    const v = process.env[g.key];
    if (v === undefined || v.trim() === '') continue; // unset is valid + fail-closed
    if (v === 'true') enabledGates.push(`  • ${g.key}="true" → ${g.enables} ENABLED (launch expectation: ${g.launch}).`);
    else if (looksLikeEnableAttempt(v)) misconfiguredGates.push(`  • ${g.key}="${v}" is NOT exactly "true" → ${g.enables} stays OFF (fail-closed). Fix the value if you meant to enable it.`);
}
if (misconfiguredGates.length > 0) {
    console.warn('\n⚠️  Fail-closed gate posture — a value that looks like an enable attempt is not exactly "true":');
    misconfiguredGates.forEach(w => console.warn(w));
}
if (enabledGates.length > 0) {
    console.warn('\n⚠️  Enabled exact-"true" gates — confirm intended for the current release phase (invite-only launch keeps Cloud OFF):');
    enabledGates.forEach(w => console.warn(w));
}

console.log('✅ All required environment variables are set');

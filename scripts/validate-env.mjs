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
    console.warn('   Stripe absent → payment/upgrade surfaces hidden; Sentry absent → error monitoring disabled.\n');
}

console.log('✅ All required environment variables are set');

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file
dotenv.config({ path: join(__dirname, '..', '.env') });

// Read required env vars from env.required
const requiredFile = join(__dirname, '..', 'env.required');
const required = fs.readFileSync(requiredFile, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));

// Check for missing vars
const missing = required.filter(key => !process.env[key]);

if (missing.length > 0) {
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ BUILD FAILED: Missing Required Environment Variables');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.error('The following environment variables are not set:\n');
    missing.forEach(v => console.error(`  • ${v}`));
    console.error('\nPlease ensure these are defined in your .env file.');
    console.error('See README.md for setup instructions.');
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    process.exit(1);
}

console.log('✅ All required environment variables are set');

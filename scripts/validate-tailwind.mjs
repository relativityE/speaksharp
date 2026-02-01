import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

function log(msg) {
  console.log(`[TAILWIND VALIDATION] ${msg}`);
}

// 1. Check for tailwind.config.ts
const configPath = path.resolve(process.cwd(), 'tailwind.config.ts');
if (!fs.existsSync(configPath)) {
  log('❌ tailwind.config.ts not found. Please ensure it exists in the project root.');
  process.exit(1);
}
log('✅ tailwind.config.ts found.');

// 2. Check Tailwind + PostCSS versions
const pkgJson = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'));
const tailwindVersion = pkgJson.dependencies?.tailwindcss || pkgJson.devDependencies?.tailwindcss;
if (!tailwindVersion) {
  log('❌ tailwindcss not installed. Run `pnpm add -D tailwindcss`.');
  process.exit(1);
}
log(`✅ tailwindcss installed (${tailwindVersion})`);

// 3. Clear Vite/PostCSS cache
log('Clearing Vite and PostCSS caches...');
execSync('rm -rf node_modules/.vite', { stdio: 'inherit' });
execSync('rm -rf node_modules/.cache', { stdio: 'inherit' });

// 4. Create minimal test CSS
const testCss = `
@tailwind base;
@tailwind components;
@tailwind utilities;

.bg-background { @apply bg-background; }
`;
fs.writeFileSync('test-tailwind.css', testCss);
log('✅ test-tailwind.css created');

// 5. Try compiling CSS via Tailwind CLI
try {
  log('Compiling test-tailwind.css...');
  execSync('npx tailwindcss -i ./test-tailwind.css -o ./dist/test.css --minify', { stdio: 'inherit' });
  log('✅ Tailwind compiled successfully! bg-background is valid.');
} catch (err) {
  log('❌ Tailwind compilation failed. Check tailwind.config.ts and CSS variable setup.');
  process.exit(1);
}

// 6. Optional: Remove test file after check
fs.unlinkSync('test-tailwind.css');
log('✅ Temporary test CSS removed. Tailwind validation complete.');

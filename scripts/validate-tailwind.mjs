import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

function log(msg) {
  console.log(`[TAILWIND VALIDATION] ${msg}`);
}

// The only Tailwind config. Vite runs from `frontend/`, so this is the file its PostCSS pipeline loads.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontendDir = path.join(repoRoot, 'frontend');
const configPath = path.join(frontendDir, 'tailwind.config.js');

// 1. Check for frontend/tailwind.config.js
if (!fs.existsSync(configPath)) {
  log('❌ frontend/tailwind.config.js not found.');
  process.exit(1);
}
log('✅ frontend/tailwind.config.js found.');

// 2. Check Tailwind + PostCSS versions
const pkgJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
const tailwindVersion = pkgJson.dependencies?.tailwindcss || pkgJson.devDependencies?.tailwindcss;
if (!tailwindVersion) {
  log('❌ tailwindcss not installed. Run `pnpm add -D tailwindcss`.');
  process.exit(1);
}
log(`✅ tailwindcss installed (${tailwindVersion})`);

// 3. Clear Vite/PostCSS cache
log('Clearing Vite and PostCSS caches...');
execSync('rm -rf node_modules/.vite node_modules/.cache', { cwd: frontendDir, stdio: 'inherit' });

// 4. Create minimal test CSS. The probe class must not share a utility's name, or `@apply` is circular.
// `bg-signature` exists only in the shared-token config, so compiling it proves that config was loaded.
const testCss = `
@tailwind base;
@tailwind components;
@tailwind utilities;

.validation-probe { @apply bg-background bg-signature; }
`;
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailwind-validation-'));
const inputPath = path.join(workDir, 'test-tailwind.css');
fs.writeFileSync(inputPath, testCss);
log('✅ test-tailwind.css created');

// 5. Try compiling CSS via Tailwind CLI against the surviving config
try {
  log('Compiling test-tailwind.css...');
  execSync(`npx tailwindcss -c "${configPath}" -i "${inputPath}" -o "${path.join(workDir, 'test.css')}" --minify`, {
    cwd: frontendDir,
    stdio: 'inherit',
  });
  log('✅ Tailwind compiled successfully! bg-background and bg-signature are valid.');
} catch (err) {
  log('❌ Tailwind compilation failed. Check frontend/tailwind.config.js and CSS variable setup.');
  process.exit(1);
} finally {
  // 6. Remove temporary files
  fs.rmSync(workDir, { recursive: true, force: true });
}
log('✅ Temporary test CSS removed. Tailwind validation complete.');

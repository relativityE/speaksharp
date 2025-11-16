#!/bin/bash
set -e

echo "=============================="
echo "1️⃣  Cleaning project environment"
echo "=============================="

# Remove node_modules, lockfiles, and caches
rm -rf node_modules package-lock.json pnpm-lock.yaml yarn.lock
rm -rf node_modules/.vite node_modules/.cache
rm -rf dist build

# Clear npm cache
npm cache clean --force

echo "✅ Environment cleaned"

echo "=============================="
echo "2️⃣  Installing dependencies"
echo "=============================="

# Install dependencies with pnpm (adjust if using npm/yarn)
pnpm install

echo "✅ Dependencies installed"

echo "=============================="
echo "3️⃣  Validating Tailwind CLI"
echo "=============================="

TEST_CSS="test-tailwind.css"
cat > $TEST_CSS <<EOL
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  background-color: hsl(var(--background));
}
EOL

if npx tailwindcss -i ./$TEST_CSS -o ./out.css --minify; then
  echo "✅ Tailwind compiled successfully"
else
  echo "❌ Tailwind compilation failed"
  exit 1
fi

rm $TEST_CSS out.css

echo "=============================="
echo "4️⃣  Start Vite dev server in background"
echo "=============================="

# Start Vite in background
pnpm dev &
VITE_PID=$!
echo "Vite PID: $VITE_PID"
sleep 5 # Give server a moment to start

echo "=============================="
echo "5️⃣  Verifying 'Sign In' link in browser"
echo "=============================="

npx playwright install chromium

node <<'EOL'
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 15000 });
    const signInVisible = await page.locator('a:has-text("Sign In")').isVisible();
    if (signInVisible) {
      console.log("✅ 'Sign In' link is visible. Environment ready for tests.");
    } else {
      console.error("❌ 'Sign In' link not found. Check app rendering.");
      process.exit(1);
    }
  } catch (err) {
    console.error("❌ Error visiting localhost:", err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
EOL

echo "=============================="
echo "6️⃣  Kill Vite server"
echo "=============================="

kill $VITE_PID || true
wait $VITE_PID 2>/dev/null || true

echo "=============================="
echo "✅ Environment reset & verification complete"
echo "=============================="

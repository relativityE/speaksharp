#!/usr/bin/env bash
set -euo pipefail

LOG_DIR="./logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/env-setup.log"

echo "=== Environment Setup & Pre-Check Start $(date) ===" | tee -a "$LOG_FILE"

# --- Node version check (flexible: >=22.12) ---
REQUIRED_NODE_MAJOR=22
REQUIRED_NODE_MINOR=12
NODE_VER=$(node -v 2>/dev/null | tr -d 'v' || echo "0.0.0")
NODE_MAJOR=$(echo $NODE_VER | cut -d. -f1)
NODE_MINOR=$(echo $NODE_VER | cut -d. -f2)

if [[ $NODE_MAJOR -lt $REQUIRED_NODE_MAJOR ]] || \
   [[ $NODE_MAJOR -eq $REQUIRED_NODE_MAJOR && $NODE_MINOR -lt $REQUIRED_NODE_MINOR ]]; then
    echo "🔧 Node $REQUIRED_NODE_MAJOR.$REQUIRED_NODE_MINOR or higher required. Installing..." | tee -a "$LOG_FILE"
    source ~/.nvm/nvm.sh
    nvm install $REQUIRED_NODE_MAJOR.$REQUIRED_NODE_MINOR
    nvm use $REQUIRED_NODE_MAJOR.$REQUIRED_NODE_MINOR
else
    echo "✅ Node version $NODE_VER is compatible." | tee -a "$LOG_FILE"
fi

# --- pnpm check ---
if ! command -v pnpm &>/dev/null; then
    echo "🔧 pnpm not found. Installing globally..." | tee -a "$LOG_FILE"
    timeout 300s npm install -g pnpm
else
    echo "✅ pnpm found: $(pnpm -v)" | tee -a "$LOG_FILE"
fi

# --- Ports check ---
for PORT in 5173 9323; do
    if lsof -i:$PORT &>/dev/null; then
        echo "❌ Port $PORT is already in use" | tee -a "$LOG_FILE"
        exit 1
    else
        echo "✅ Port $PORT is free" | tee -a "$LOG_FILE"
    fi
done

# --- Environment variables check ---
REQUIRED_ENV_VARS=(VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY TEST_USER_EMAIL TEST_USER_PASSWORD)
for VAR in "${REQUIRED_ENV_VARS[@]}"; do
    if ! grep -q "^$VAR=" .env.test; then
        echo "❌ Missing environment variable: $VAR" | tee -a "$LOG_FILE"
        exit 1
    else
        echo "✅ $VAR is set" | tee -a "$LOG_FILE"
    fi
done

# --- Install project dependencies ---
echo "🔧 Installing project dependencies..." | tee -a "$LOG_FILE"
timeout 300s pnpm install | tee -a "$LOG_FILE"

# --- Playwright browsers check ---
echo "🔧 Ensuring Playwright browsers installed..." | tee -a "$LOG_FILE"
timeout 300s pnpm exec playwright install --with-deps | tee -a "$LOG_FILE"

touch "$LOG_DIR/.env-setup-complete"
echo "✅ Environment setup and pre-check complete." | tee -a "$LOG_FILE"

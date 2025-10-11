#!/usr/bin/env bash
set -euo pipefail

LOG_DIR="./logs"
mkdir -p "$LOG_DIR"

echo "=== Pre-Check Start $(date) ===" | tee -a "$LOG_DIR/pre-check.log"

# --- Node version check ---
REQUIRED_NODE="22.12.0"
CURRENT_NODE=$(node -v | tr -d 'v')
if [[ "$CURRENT_NODE" != "$REQUIRED_NODE" ]]; then
    echo "❌ Node version mismatch: required $REQUIRED_NODE, found $CURRENT_NODE" | tee -a "$LOG_DIR/pre-check.log"
    echo "Run: source ~/.nvm/nvm.sh && nvm install $REQUIRED_NODE && nvm use $REQUIRED_NODE"
    exit 1
fi

# --- pnpm check ---
if ! command -v pnpm &>/dev/null; then
    echo "❌ pnpm not found. Install with: npm install -g pnpm" | tee -a "$LOG_DIR/pre-check.log"
    exit 1
fi

# --- Ports check ---
for PORT in 5173 9323; do
    if lsof -i:$PORT &>/dev/null; then
        echo "❌ Port $PORT is already in use" | tee -a "$LOG_DIR/pre-check.log"
        exit 1
    fi
done

# --- Environment variables check via dotenv-cli ---
if ! npx dotenv -e .env.test -- printenv VITE_SUPABASE_URL &>/dev/null; then
    echo "❌ Missing required environment variables in .env.test" | tee -a "$LOG_DIR/pre-check.log"
    exit 1
fi

# --- Playwright browsers check ---
if ! pnpm exec playwright install --with-deps | tee -a "$LOG_DIR/pre-check.log"; then
    echo "❌ Playwright browsers not installed correctly" | tee -a "$LOG_DIR/pre-check.log"
    exit 1
fi

echo "✅ Pre-check passed. Environment ready." | tee -a "$LOG_DIR/pre-check.log"

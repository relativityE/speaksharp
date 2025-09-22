#!/bin/bash
set -euo pipefail

# Idempotent developer startup script

# 1. Install dependencies if node_modules is missing
if [ ! -d "node_modules" ]; then
  echo "📦 node_modules not found. Running pnpm install..."
  pnpm install
fi

# 2. Create .env from .env.test if it doesn't exist
if [ ! -f ".env" ]; then
  echo "📋 .env file not found. Copying from .env.test..."
  cp .env.test .env
fi

# 3. Start Supabase
echo "🐘 Starting Supabase services..."
supabase start

# 4. Start the development server
echo "🚀 Starting development server..."
pnpm exec vite

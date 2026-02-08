#!/bin/bash

# ============================================================================
# SpeakSharp Soak Test - User Verification Script
# ============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Load from .env.development if it exists
if [ -f .env.development ]; then
    export $(grep -v '^#' .env.development | xargs)
fi

SUPABASE_URL="${VITE_SUPABASE_URL:-}"
SUPABASE_ANON_KEY="${VITE_SUPABASE_ANON_KEY:-}"
SOAK_TEST_PASSWORD="${SOAK_TEST_PASSWORD:-password123}"

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}     SpeakSharp Soak Test - User Verification${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ]; then
    echo -e "${RED}❌ Error: SUPABASE_URL or SUPABASE_ANON_KEY not found in environment${NC}"
    exit 1
fi

SUCCESS_COUNT=0
FAIL_COUNT=0

for i in {0..9}; do
    EMAIL="soak-test${i}@test.com"
    START_TIME=$(date +%s%3N)
    
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
        "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
        -H "apikey: ${SUPABASE_ANON_KEY}" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"${EMAIL}\",\"password\":\"${SOAK_TEST_PASSWORD}\"}")
    
    END_TIME=$(date +%s%3N)
    DURATION=$((END_TIME - START_TIME))
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    
    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "${GREEN}✅ ${EMAIL}${NC} | HTTP ${HTTP_CODE} in ${DURATION}ms"
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    else
        echo -e "${RED}❌ ${EMAIL}${NC} | HTTP ${HTTP_CODE} in ${DURATION}ms"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
done

echo -e "\nSummary: ${GREEN}${SUCCESS_COUNT} PASS${NC}, ${RED}${FAIL_COUNT} FAIL${NC}"
[ $FAIL_COUNT -eq 0 ] || exit 1

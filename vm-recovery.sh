#!/bin/bash
# vm-recovery.sh - Clean environment before tests

set -euxo pipefail

log() { echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"; }

log "Resetting git state..."
git reset --hard HEAD
git clean -fdx
git checkout main || git checkout master

log "Removing node_modules and caches..."
rm -rf node_modules
pnpm store prune

log "VM recovery complete"

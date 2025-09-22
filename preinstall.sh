#!/bin/bash
# preinstall.sh - Restore lockfile and install dependencies

set -euxo pipefail

log() { echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"; }

log "Restoring lockfile..."
pnpm install  # Not frozen to ensure node_modules is populated

log "Dependencies installed"

'use strict';

const { spawnSync } = require('node:child_process');

const RESERVE_SCRIPT = [
  'import os, sys, time',
  'from pathlib import Path',
  'sys.path.insert(0, os.environ["RWT_GH_BUDGET_APP"])',
  'import server',
  'server.DB = Path(os.environ["RWT_GH_BUDGET_DB"])',
  'if time.time() < server.github_backoff_until(): sys.exit(76)',
  'ok, _state = server.reserve_github_request_budget()',
  'sys.exit(0 if ok else 75)',
].join('\n');

function reserveGitHubRequest() {
  const env = {
    PATH: process.env.PATH || '/usr/bin:/bin',
    RWT_GH_BUDGET_APP: process.env.RWT_GH_BUDGET_APP || '',
    RWT_GH_BUDGET_DB: process.env.RWT_GH_BUDGET_DB || '',
    RWT_GH_REQUEST_BUDGET_PER_MINUTE: process.env.RWT_GH_REQUEST_BUDGET_PER_MINUTE || '60',
  };
  const python = process.env.RWT_GH_BUDGET_PYTHON || 'python3';
  const result = spawnSync(python, ['-c', RESERVE_SCRIPT], {
    env,
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
  });
  if (result.error) throw new Error('github_request_budget_reservation_failed');
  if (result.status === 76) throw new Error('github_request_budget_backoff');
  if (result.status !== 0) throw new Error('github_request_budget_exhausted');
}

function makeBudgetedFetch(fetchImpl, reserve = reserveGitHubRequest) {
  return async function budgetedFetch(input, init = {}) {
    const rawUrl = typeof input === 'string' || input instanceof URL
      ? String(input)
      : String(input?.url ?? '');
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return fetchImpl(input, init);
    }
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'api.github.com') {
      return fetchImpl(input, init);
    }
    // Reserve atomically before every GitHub API request. Manual redirects prevent fetch from
    // issuing an unobserved second request behind this adapter.
    reserve();
    return fetchImpl(input, { ...init, redirect: 'manual' });
  };
}

if (typeof globalThis.fetch === 'function') {
  globalThis.fetch = makeBudgetedFetch(globalThis.fetch);
}

module.exports = { makeBudgetedFetch, reserveGitHubRequest };

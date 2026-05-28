console.warn('[QualityMetrics] scripts/update-prd-metrics.mjs is a compatibility wrapper. PRD metrics are no longer rewritten; generating software quality evidence instead.');
await import('./write-software-quality-evidence.mjs');

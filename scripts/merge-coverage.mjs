import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import libCoverage from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const coverageDir = path.join(ROOT, 'artifacts/coverage');

const map = libCoverage.createCoverageMap();

// In CI, when downloading merged artifacts from multiple matrix jobs, GitHub Actions
// (using merge-multiple: true) flattens the files. Therefore, coverage files might not
// be strictly inside shard-X folders but named/placed based on the artifact structure.
// However, since we defined our paths exactly in ci.yml:
// path: artifacts/coverage/shard-${{ matrix.shard }}
// They will exist in shard-X/
let mergedCount = 0;
for (let shard = 1; shard <= 4; shard++) {
  const jsonPath = path.join(coverageDir, `shard-${shard}`, 'coverage-final.json');
  if (fs.existsSync(jsonPath)) {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    map.merge(data);
    console.log(`Merged shard-${shard} coverage`);
    mergedCount++;
  } else {
    console.warn(`Warning: Missing coverage for shard-${shard}`);
  }
}

// Fallback logic for local or direct merges if paths are slightly different
if (mergedCount === 0) {
  console.log('Attempting to find coverage-final.json files dynamically...');
  const files = fs.readdirSync(coverageDir, { recursive: true });
  for (const file of files) {
    if (file.endsWith('coverage-final.json')) {
      const jsonPath = path.join(coverageDir, file);
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      map.merge(data);
      console.log(`Merged dynamically found coverage file: ${file}`);
      mergedCount++;
    }
  }
}

if (mergedCount === 0) {
  console.warn('No coverage files were merged!');
}

const context = libReport.createContext({
  dir: coverageDir,
  coverageMap: map,
});

reports.create('json-summary').execute(context);
reports.create('json').execute(context);
reports.create('text').execute(context);
reports.create('html').execute(context);
reports.create('clover').execute(context);

console.log('Successfully generated merged coverage reports');


// Also merge unit-metrics.json
let mergedMetrics = {
    numPassedTests: 0,
    numFailedTests: 0,
    numFailedSuites: 0,
    numTotalTests: 0,
    totalDuration: 0,
    numPendingTests: 0,
    failures: [],
};
let metricsMergedCount = 0;

for (let shard = 1; shard <= 4; shard++) {
    const shardMetricsPath = path.join(coverageDir, `shard-${shard}`, 'unit-metrics.json');
    if (fs.existsSync(shardMetricsPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(shardMetricsPath, 'utf8'));
            mergedMetrics.numPassedTests += (data.numPassedTests || 0);
            mergedMetrics.numFailedTests += (data.numFailedTests || 0);
            mergedMetrics.numFailedSuites += (data.numFailedSuites || 0);
            mergedMetrics.numTotalTests += (data.numTotalTests || 0);
            mergedMetrics.totalDuration += (data.totalDuration || 0);
            mergedMetrics.numPendingTests += (data.numPendingTests || 0);
            if (Array.isArray(data.failures)) {
                mergedMetrics.failures = mergedMetrics.failures.concat(data.failures);
            }
            metricsMergedCount++;
            console.log(`Merged shard-${shard} unit-metrics`);
        } catch (e) {
            console.warn(`Failed to parse ${shardMetricsPath}:`, e.message);
        }
    }
}

if (metricsMergedCount > 0) {
    // Write directly to root for compatibility with upload-artifact
    fs.writeFileSync(path.join(ROOT, 'unit-metrics.json'), JSON.stringify(mergedMetrics, null, 2));
    console.log(`Successfully generated merged unit-metrics.json from ${metricsMergedCount} shards`);
} else {
    console.warn('No unit-metrics files were merged!');
}

// --- Coverage Threshold Enforcement ---
const summaryPath = path.join(coverageDir, 'coverage-summary.json');
if (fs.existsSync(summaryPath)) {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

    const thresholds = {
        global: {
            statements: 75,
            branches: 75,
            functions: 75,
            lines: 75,
        },
        files: {
            'frontend/src/services/transcription/ModelManager.ts': { statements: 75, branches: 75, functions: 70, lines: 75 },
            'frontend/src/services/transcription/engines/transformers-js.worker.ts': { statements: 80, branches: 60, functions: 75, lines: 80 },
            'frontend/src/services/transcription/modes/NativeBrowser.ts': { statements: 55, branches: 45, functions: 40, lines: 55 },
            'frontend/src/services/transcription/modes/nativeBrowserStrategies.ts': { statements: 90, branches: 85, functions: 90, lines: 90 },
            'frontend/src/services/transcription/utils/AudioProcessor.ts': { statements: 65, branches: 85, functions: 75, lines: 65 },
            'frontend/src/services/transcription/utils/audio-processor.worker.ts': { statements: 60, branches: 80, functions: 75, lines: 60 },
            'frontend/src/utils/sessionAnalysis.ts': { statements: 80, branches: 65, functions: 70, lines: 80 },
            'frontend/src/utils/fillerWordUtils.ts': { statements: 75, branches: 90, functions: 65, lines: 75 },
        }
    };

    let failed = false;

    // Check global thresholds
    const total = summary.total || {};
    for (const key of ['statements', 'branches', 'functions', 'lines']) {
        const actual = total[key] ? total[key].pct : 0;
        const expected = thresholds.global[key];
        if (actual < expected) {
            console.error(`ERROR: Coverage for ${key} (${actual}%) does not meet global threshold (${expected}%)`);
            failed = true;
        }
    }

    // Check per-file thresholds
    for (const [filePart, fileThresholds] of Object.entries(thresholds.files)) {
        // Find matching file in summary since paths in summary might be absolute
        const matchingKey = Object.keys(summary).find(k => k.includes(filePart));
        if (matchingKey) {
            const fileSummary = summary[matchingKey];
            for (const key of ['statements', 'branches', 'functions', 'lines']) {
                const actual = fileSummary[key] ? fileSummary[key].pct : 0;
                const expected = fileThresholds[key];
                if (actual < expected) {
                    console.error(`ERROR: Coverage for ${key} in ${filePart} (${actual}%) does not meet threshold (${expected}%)`);
                    failed = true;
                }
            }
        } else {
            console.warn(`WARNING: Could not find ${filePart} in coverage summary to enforce file-specific thresholds.`);
        }
    }

    if (failed) {
        console.error('ERROR: One or more coverage thresholds were not met.');
        process.exit(1);
    } else {
        console.log('✅ All coverage thresholds met.');
    }
} else {
    console.warn('WARNING: coverage-summary.json not found, skipping threshold enforcement.');
}

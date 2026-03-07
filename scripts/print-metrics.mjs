#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const METRICS_FILE = path.resolve(process.cwd(), 'test-results/metrics.json');

// ANSI codes for terminal formatting (dark-mode friendly)
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const WHITE = '\x1b[37m';
const RESET = '\x1b[0m';

// Industry standard targets
const TARGETS = {
  lines: 80,        // 80% line coverage is industry standard
  branches: 80,     // 80% branch coverage is industry standard
  bloat: 20,        // < 20% bloat is industry standard for optimized SPAs
};

function getIndicator(value, target, lowerIsBetter = false) {
  if (lowerIsBetter) {
    if (value < target) return `${GREEN}✓${RESET}`;
    if (value < target * 1.5) return `${YELLOW}~${RESET}`;
    return `${RED}✗${RESET}`;
  } else {
    if (value >= target) return `${GREEN}✓${RESET}`;
    if (value >= target * 0.7) return `${YELLOW}~${RESET}`;
    return `${RED}✗${RESET}`;
  }
}

function printMetrics() {
  if (!fs.existsSync(METRICS_FILE)) {
    console.error(`❌ Error: Metrics file not found at ${METRICS_FILE}`);
    process.exit(1);
  }

  try {
    const metricsData = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf-8'));

    console.log("\n--- 📊 Software Quality Metrics Summary ---");

    // Unit Tests
    const { unit_tests } = metricsData;
    console.log("\n🧪 Unit Tests:");
    console.log(`  Passed: ${unit_tests.passed} / ${unit_tests.total}`);

    // Coverage Summary with industry targets
    const { coverage } = metricsData;
    const linesInd = getIndicator(coverage.lines, TARGETS.lines);
    const branchInd = getIndicator(coverage.branches, TARGETS.branches);

    console.log("\n📈 Coverage Summary:");
    console.log(`  Statements: ${coverage.statements}%`);
    console.log(`  ${BOLD}${WHITE}Branches:   ${coverage.branches}%${RESET}  ${branchInd} ${CYAN}(industry std: ${TARGETS.branches}%)${RESET}`);
    console.log(`  Functions:  ${coverage.functions}%`);
    console.log(`  ${BOLD}${WHITE}Lines:      ${coverage.lines}%${RESET}  ${linesInd} ${CYAN}(industry std: ${TARGETS.lines}%)${RESET}`);

    // E2E Tests
    const { e2e_tests } = metricsData;
    console.log("\n🌐 E2E Tests:");
    console.log(`  Passed:  ${e2e_tests.passed} / ${e2e_tests.total}`);
    console.log(`  Failed:  ${e2e_tests.failed}`);
    console.log(`  Skipped: ${e2e_tests.skipped}`);

    // Performance & Size
    const { performance } = metricsData;
    const bloatPct = parseFloat(performance.bloat_percentage);
    const bloatInd = getIndicator(bloatPct, TARGETS.bloat, true);

    console.log("\n📐 Codebase & Performance:");
    console.log(`  Total Source Size:  ${performance.source_size}`);
    console.log(`  Total Project Size: ${performance.total_size}`);
    console.log(`  Initial Chunk:      ${performance.initial_chunk_size}`);
    console.log(`  ${BOLD}${WHITE}Code Bloat Index:   ${performance.bloat_percentage}%${RESET}  ${bloatInd} ${CYAN}(industry std: <${TARGETS.bloat}%)${RESET}`);

    // Lighthouse Scores (all 4 categories)
    const { lighthouse } = metricsData;
    if (lighthouse && (lighthouse.performance > 0 || lighthouse.accessibility > 0)) {
      const getInd = (score) => score >= 90 ? `${GREEN}✓${RESET}` : (score >= 50 ? `${YELLOW}~${RESET}` : `${RED}✗${RESET}`);
      console.log("\n🔦 Lighthouse Scores:");
      console.log(`  ${BOLD}${WHITE}Performance:     ${lighthouse.performance}${RESET}  ${getInd(lighthouse.performance)} ${CYAN}(target: 90+)${RESET}`);
      console.log(`  ${BOLD}${WHITE}Accessibility:   ${lighthouse.accessibility}${RESET}  ${getInd(lighthouse.accessibility)} ${CYAN}(target: 90+)${RESET}`);
      console.log(`  ${BOLD}${WHITE}Best Practices:  ${lighthouse.best_practices}${RESET}  ${getInd(lighthouse.best_practices)} ${CYAN}(target: 90+)${RESET}`);
      console.log(`  ${BOLD}${WHITE}SEO:             ${lighthouse.seo}${RESET}  ${getInd(lighthouse.seo)} ${CYAN}(target: 90+)${RESET}`);
    }

    console.log("\n------------------------------------------");
    console.log(`${CYAN}Legend: ${GREEN}✓${RESET} meets std  ${YELLOW}~${RESET} close  ${RED}✗${RESET} below std`);

  } catch (error) {
    console.error(`❌ Error parsing metrics file: ${error.message}`);
    process.exit(1);
  }
}

printMetrics();

import fs from "fs";
import path from "path";

export default class TelemetryReporter {
  constructor() {
    this.results = {
      stats: {
        expected: 0,
        unexpected: 0,
        flaky: 0,
        skipped: 0,
        total: 0
      },
      tests: []
    };
    this.testOutcomes = new Map();
  }

  onTestEnd(test, result) {
    const title = test.titlePath().join(" › ");
    const outcome = test.outcome();

    // Store the latest outcome for this unique test ID to deduplicate retries
    this.testOutcomes.set(test.id, {
      title,
      status: result.status,
      outcome,
      retry: result.retry,
      duration: result.duration,
      error: result.error
    });

    // Console logging for real-time visibility (mirrors original behavior)
    if (outcome === "flaky") {
      console.log(`[PW][FLAKY] ${title} (retry ${result.retry})`);
    } else if (outcome === "unexpected") {
      console.log(`[PW][${result.status.toUpperCase()}] ${title}`);
      if (result.error?.message) {
        const cleanMsg = (result.error.message || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
        console.log(`[PW][ERROR] ${cleanMsg}`);
      }
    }
  }

  onEnd() {
    const rootDir = process.cwd();
    
    // Reset and recalculate deduplicated stats
    this.results.stats = { expected: 0, unexpected: 0, flaky: 0, skipped: 0, total: 0 };
    this.results.tests = [];

    for (const [id, data] of this.testOutcomes.entries()) {
      this.results.tests.push({
        id,
        title: data.title,
        status: data.status,
        outcome: data.outcome,
        retries: data.retry,
        duration: data.duration
      });

      switch (data.outcome) {
        case "expected":
          this.results.stats.expected++;
          break;
        case "flaky":
          this.results.stats.flaky++;
          break;
        case "unexpected":
          this.results.stats.unexpected++;
          break;
        case "skipped":
          this.results.stats.skipped++;
          break;
      }
    }
    this.results.stats.total = this.testOutcomes.size;

    // Path A: Expected by run-ci.mjs (Stage 3 Guard)
    const resultsPathA = path.join(rootDir, "test-results", "playwright-results.json");
    
    // Path B: Expected by run-metrics.sh (Stage 5)
    const resultsDirB = path.join(rootDir, "test-results", "playwright");
    const resultsPathB = path.join(resultsDirB, "results.json");

    fs.mkdirSync(path.dirname(resultsPathA), { recursive: true });
    fs.mkdirSync(resultsDirB, { recursive: true });

    const content = JSON.stringify(this.results, null, 2);
    fs.writeFileSync(resultsPathA, content);
    fs.writeFileSync(resultsPathB, content);

    // Direct Telemetry Emission via IPC
    if (process.send) {
      process.send({
        type: 'TELEMETRY',
        tool: 'playwright',
        data: this.results
      });
    }

    console.log(
      `[PW] Summary: ${this.results.stats.expected} passed, ` +
      `${this.results.stats.unexpected} failed, ` +
      `${this.results.stats.flaky} flaky (Total unique: ${this.results.stats.total})`
    );
  }
}

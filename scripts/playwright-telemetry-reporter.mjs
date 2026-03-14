import fs from "fs";
import path from "path";

export default class TelemetryReporter {
  constructor() {
    this.results = {
      stats: {
        expected: 0,
        unexpected: 0,
        flaky: 0,
        skipped: 0
      },
      tests: []
    };
  }

  onTestEnd(test, result) {
    const title = test.titlePath().join(" › ");
    const outcome = test.outcome();

    const entry = {
      title,
      status: result.status,
      outcome: outcome,
      retries: result.retry,
      duration: result.duration
    };

    this.results.tests.push(entry);

    switch (outcome) {
      case "expected":
        this.results.stats.expected++;
        break;

      case "flaky":
        this.results.stats.flaky++;
        console.log(`[PW][FLAKY] ${title} (retry ${result.retry})`);
        break;

      case "unexpected":
        this.results.stats.unexpected++;
        console.log(`[PW][${result.status.toUpperCase()}] ${title}`);
        if (result.error?.message) {
          const cleanMsg = (result.error.message || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
          console.log(`[PW][ERROR] ${cleanMsg}`);
        }
        break;

      case "skipped":
        this.results.stats.skipped++;
        break;
    }
  }

  onEnd() {
    const rootDir = process.cwd();
    
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

    // Direct Telemetry Emission via IPC (Fix: IPC Protocol Bug)
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
      `${this.results.stats.flaky} flaky`
    );
  }
}

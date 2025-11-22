import type { Page } from '@playwright/test';

/**
 * Metric data point with timestamp
 */
export interface MetricPoint {
    timestamp: number;
    value: number;
    label?: string;
}

/**
 * Aggregated statistics for a metric
 */
export interface MetricStats {
    count: number;
    min: number;
    max: number;
    avg: number;
    median: number;
    p95: number;
    p99: number;
}

/**
 * Full report of all collected metrics
 */
export interface SoakTestReport {
    duration: number;
    startTime: number;
    endTime: number;
    concurrentUsers: number;
    metrics: {
        responseTime: MetricStats;
        memoryUsage: MetricStats;
        errorCount: number;
        successCount: number;
    };
    timeSeries: {
        responseTime: MetricPoint[];
        memoryUsage: MetricPoint[];
    };
}

/**
 * Metrics collector for soak tests
 */
export class MetricsCollector {
    private responseTimeSamples: number[] = [];
    private memoryUsageSamples: number[] = [];
    private errorCount = 0;
    private successCount = 0;
    private startTime = 0;

    constructor() {
        this.startTime = Date.now();
    }

    /**
     * Record a response time measurement
     */
    recordResponseTime(timeMs: number, label?: string): void {
        this.responseTimeSamples.push(timeMs);
    }

    /**
     * Record memory usage from a Playwright page
     */
    async recordMemoryUsage(page: Page): Promise<void> {
        try {
            const metrics = await page.evaluate(() => {
                if (performance.memory) {
                    return {
                        usedJSHeapSize: performance.memory.usedJSHeapSize,
                        totalJSHeapSize: performance.memory.totalJSHeapSize,
                    };
                }
                return null;
            });

            if (metrics) {
                // Convert to MB for readability
                const usedMB = metrics.usedJSHeapSize / (1024 * 1024);
                this.memoryUsageSamples.push(usedMB);
            }
        } catch (error) {
            // Silently fail if memory API is not available
        }
    }

    /**
     * Record a successful operation
     */
    recordSuccess(): void {
        this.successCount++;
    }

    /**
     * Record a failed operation
     */
    recordError(): void {
        this.errorCount++;
    }

    /**
     * Calculate percentile from sorted array
     */
    private percentile(sortedArray: number[], p: number): number {
        if (sortedArray.length === 0) return 0;
        const index = Math.ceil((p / 100) * sortedArray.length) - 1;
        return sortedArray[Math.max(0, index)];
    }

    /**
     * Calculate statistics for an array of numbers
     */
    private calculateStats(samples: number[]): MetricStats {
        if (samples.length === 0) {
            return { count: 0, min: 0, max: 0, avg: 0, median: 0, p95: 0, p99: 0 };
        }

        const sorted = [...samples].sort((a, b) => a - b);
        const sum = sorted.reduce((acc, val) => acc + val, 0);

        return {
            count: sorted.length,
            min: sorted[0],
            max: sorted[sorted.length - 1],
            avg: sum / sorted.length,
            median: this.percentile(sorted, 50),
            p95: this.percentile(sorted, 95),
            p99: this.percentile(sorted, 99),
        };
    }

    /**
     * Generate final report
     */
    generateReport(concurrentUsers: number): SoakTestReport {
        const endTime = Date.now();
        const duration = endTime - this.startTime;

        return {
            duration,
            startTime: this.startTime,
            endTime,
            concurrentUsers,
            metrics: {
                responseTime: this.calculateStats(this.responseTimeSamples),
                memoryUsage: this.calculateStats(this.memoryUsageSamples),
                errorCount: this.errorCount,
                successCount: this.successCount,
            },
            timeSeries: {
                responseTime: this.responseTimeSamples.map((value, index) => ({
                    timestamp: this.startTime + (index * (duration / this.responseTimeSamples.length)),
                    value,
                })),
                memoryUsage: this.memoryUsageSamples.map((value, index) => ({
                    timestamp: this.startTime + (index * (duration / this.memoryUsageSamples.length)),
                    value,
                })),
            },
        };
    }

    /**
     * Print a human-readable summary to console
     */
    printSummary(report: SoakTestReport): void {
        const durationSec = (report.duration / 1000).toFixed(1);

        console.log('\n═══════════════════════════════════════════════');
        console.log('           SOAK TEST SUMMARY');
        console.log('═══════════════════════════════════════════════');
        console.log(`Duration:         ${durationSec}s`);
        console.log(`Concurrent Users: ${report.concurrentUsers}`);
        console.log(`Success Rate:     ${report.metrics.successCount}/${report.metrics.successCount + report.metrics.errorCount}`);
        console.log(`Error Count:      ${report.metrics.errorCount}`);
        console.log('\n───────────────────────────────────────────────');
        console.log('Response Time (ms):');
        console.log(`  Min:     ${report.metrics.responseTime.min.toFixed(2)}`);
        console.log(`  Max:     ${report.metrics.responseTime.max.toFixed(2)}`);
        console.log(`  Avg:     ${report.metrics.responseTime.avg.toFixed(2)}`);
        console.log(`  Median:  ${report.metrics.responseTime.median.toFixed(2)}`);
        console.log(`  P95:     ${report.metrics.responseTime.p95.toFixed(2)}`);
        console.log(`  P99:     ${report.metrics.responseTime.p99.toFixed(2)}`);

        if (report.metrics.memoryUsage.count > 0) {
            console.log('\n───────────────────────────────────────────────');
            console.log('Memory Usage (MB):');
            console.log(`  Min:     ${report.metrics.memoryUsage.min.toFixed(2)}`);
            console.log(`  Max:     ${report.metrics.memoryUsage.max.toFixed(2)}`);
            console.log(`  Avg:     ${report.metrics.memoryUsage.avg.toFixed(2)}`);
            console.log(`  P95:     ${report.metrics.memoryUsage.p95.toFixed(2)}`);
        }

        console.log('═══════════════════════════════════════════════\n');
    }
}

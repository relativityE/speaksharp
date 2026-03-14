import fs from 'fs';
import path from 'path';

/**
 * Procedural Lighthouse LHR Parser (Expert Phase 5)
 * Aggregates scores from raw *.report.json files in a directory.
 */
export function parseLighthouse(rootDir) {
    const resultsDir = path.join(rootDir, 'artifacts', 'lighthouse');
    if (!fs.existsSync(resultsDir)) {
        return { performance: 0, accessibility: 0, bestPractices: 0, seo: 0, count: 0 };
    }

    try {
        const files = fs.readdirSync(resultsDir).filter(f => f.endsWith('.report.json'));
        if (files.length === 0) return { performance: 0, accessibility: 0, bestPractices: 0, seo: 0, count: 0 };

        const totals = { performance: 0, accessibility: 0, bestPractices: 0, seo: 0 };
        let count = 0;

        for (const file of files) {
            const filePath = path.join(resultsDir, file);
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            
            if (data.categories) {
                totals.performance += (data.categories.performance?.score || 0) * 100;
                totals.accessibility += (data.categories.accessibility?.score || 0) * 100;
                totals.bestPractices += (data.categories['best-practices']?.score || 0) * 100;
                totals.seo += (data.categories.seo?.score || 0) * 100;
                count++;
            }
        }

        if (count === 0) return { performance: 0, accessibility: 0, bestPractices: 0, seo: 0, count: 0 };

        return {
            performance: Math.round(totals.performance / count),
            accessibility: Math.round(totals.accessibility / count),
            bestPractices: Math.round(totals.bestPractices / count),
            seo: Math.round(totals.seo / count),
            count
        };
    } catch (e) {
        console.warn('⚠️ [LH Parser] Error:', e.message);
        return { performance: 0, accessibility: 0, bestPractices: 0, seo: 0, count: 0 };
    }
}

// CLI Mode
if (import.meta.url === `file://${process.argv[1]}`) {
    const rootDir = process.argv[2] || '.';
    const results = parseLighthouse(rootDir);
    console.log(JSON.stringify(results, null, 2));
}

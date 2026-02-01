import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LHCI_DIR = path.resolve(__dirname, '../.lighthouseci');

function findLatestReport() {
    if (!fs.existsSync(LHCI_DIR)) {
        return null;
    }

    const files = fs.readdirSync(LHCI_DIR)
        .filter(f => f.startsWith('lhr-') && f.endsWith('.json'))
        .map(f => path.join(LHCI_DIR, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

    return files[0];
}

function main() {
    const reportPath = findLatestReport();
    if (!reportPath) {
        console.error('⚠️ Could not find Lighthouse JSON report.');
        process.exit(1);
    }

    try {
        const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
        const categories = report.categories;

        console.log('📊 Lighthouse Scores:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        const scores = {
            Performance: categories.performance.score * 100,
            Accessibility: categories.accessibility.score * 100,
            'Best Practices': categories['best-practices'].score * 100,
            SEO: categories.seo.score * 100,
        };

        for (const [category, score] of Object.entries(scores)) {
            console.log(`${category.padEnd(16)}: ${Math.round(score)}`);
        }
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    } catch (error) {
        console.error('❌ Failed to parse Lighthouse report:', error.message);
        process.exit(1);
    }
}

main();

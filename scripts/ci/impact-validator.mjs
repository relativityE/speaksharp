import madge from 'madge';
import fs from 'fs';
import path from 'path';

const MAP_PATH = path.resolve('test-impact-map.json');
const SRC_DIR = path.resolve('frontend/src');

async function validate() {
    console.log('🔍 Validating Test Impact Map...');

    if (!fs.existsSync(MAP_PATH)) {
        console.error('❌ test-impact-map.json not found!');
        process.exit(1);
    }

    const impactMap = JSON.parse(fs.readFileSync(MAP_PATH, 'utf-8'));
    const mappedDirs = Object.keys(impactMap);

    // Get all dependencies in the frontend
    const res = await madge(SRC_DIR, {
        baseDir: path.resolve('frontend'),
        fileExtensions: ['ts', 'tsx', 'js', 'jsx']
    });

    const allFiles = res.obj();
    const unmappedFiles = [];

    for (const file of Object.keys(allFiles)) {
        const fullPath = `frontend/${file}`;

        // Ignore external dependencies/parent dirs detected by madge
        if (file.includes('..')) continue;

        const isInSrcOrTests = fullPath.startsWith('frontend/src/') || fullPath.startsWith('frontend/tests/');
        if (!isInSrcOrTests) continue;

        const isMapped = mappedDirs.some(dir => fullPath.startsWith(dir));

        if (!isMapped && !fullPath.includes('__tests__') && !fullPath.endsWith('.d.ts')) {
            unmappedFiles.push(fullPath);
        }
    }

    if (unmappedFiles.length > 0) {
        console.warn('⚠️  Found unmapped files in TIA map:');
        unmappedFiles.forEach(f => console.log(`  - ${f}`));
        console.error('\n❌ TIA Map is out of sync. Please update test-impact-map.json to include these new paths.');
        process.exit(1);
    }

    console.log('✅ TIA Map is valid and covers all source files.');
}

validate().catch(err => {
    console.error('💥 Validation failed:', err);
    process.exit(1);
});

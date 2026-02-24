import { parseTranscriptForHighlighting } from '../frontend/src/utils/highlightUtils';

/**
 * Benchmark for parseTranscriptForHighlighting
 * This script measures the performance impact of regex compilation.
 */

const ITERATIONS = 5000;
const text = "Um, I think so. You know, it's actually basically literally kind of sort of like amazing. SpeakSharp is great.";
const customWords = ["SpeakSharp", "basically", "literally"];
const largeText = text.repeat(20);

function benchmark(name: string, fn: () => void) {
    // Warmup
    for (let i = 0; i < 100; i++) fn();

    const start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        fn();
    }
    const end = performance.now();
    const total = end - start;
    const avg = total / ITERATIONS;
    console.log(`${name.padEnd(25)}: ${total.toFixed(2)}ms (avg: ${avg.toFixed(4)}ms)`);
    return total;
}

console.log(`🚀 Starting Benchmark (${ITERATIONS} iterations)\n`);

benchmark('Stable customWords', () => {
    parseTranscriptForHighlighting(text, customWords);
});

benchmark('Changing customWords', () => {
    // This will still benefit if the cache has multiple entries
    const words = Math.random() > 0.5 ? ["SpeakSharp", "basically"] : ["literally", "amazing"];
    parseTranscriptForHighlighting(text, words);
});

let uniqueCounter = 0;
benchmark('Unique customWords', () => {
    // This will always miss as we have unique words every time
    parseTranscriptForHighlighting(text, [`word-${uniqueCounter++}`]);
});

benchmark('Large text (stable)', () => {
    parseTranscriptForHighlighting(largeText, customWords);
});

console.log('\n✅ Benchmark complete');

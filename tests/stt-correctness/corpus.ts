import fs from 'fs';
import path from 'path';

export interface SpeechFixture {
    name: string;
    transcript: string;
    metadata: {
        words: number;
        fillerWords: string[];
        fillerCounts?: Record<string, number>;
        speakers: number;
        duration: number;
        type: string;
        expectedSpeakerSegments?: Array<{ speaker: string; text: string }>;
    };
}

const FIXTURES_DIR = path.resolve(process.cwd(), 'tests/fixtures/speeches');

export const getSpeechCorpus = (): SpeechFixture[] => {
    const dirs = fs.readdirSync(FIXTURES_DIR);

    return dirs.map(dir => {
        const dirPath = path.join(FIXTURES_DIR, dir);
        if (!fs.statSync(dirPath).isDirectory()) return null;

        const transcript = fs.readFileSync(path.join(dirPath, 'transcript.txt'), 'utf-8');
        const metadata = JSON.parse(fs.readFileSync(path.join(dirPath, 'metadata.json'), 'utf-8'));

        return {
            name: dir,
            transcript,
            metadata
        };
    }).filter(Boolean) as SpeechFixture[];
};

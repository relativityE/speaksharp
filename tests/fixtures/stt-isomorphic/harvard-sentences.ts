/**
 * Harvard Sentences Foundation
 * 
 * Phonetically balanced sentences used for standardized speech intelligibility 
 * and Word Error Rate (WER) testing across all STT engines in the pipeline.
 * 
 * These sentences represent the "Ground Truth" for generating our static 
 * audio fixtures and calculating the baseline engine accuracy ceilings.
 */

export interface ISentenceFixture {
    id: string;
    transcript: string;
}

export const HARVARD_SENTENCES: ISentenceFixture[] = [
    { id: 'h1_1', transcript: "The stale smell of old beer lingers." },
    { id: 'h1_2', transcript: "A dash of pepper spoils beef stew." },
    { id: 'h1_3', transcript: "The swan dive was far short of perfect." },
    { id: 'h1_4', transcript: "The box was thrown beside the parked truck." },
    { id: 'h1_5', transcript: "The twister left no trace of the town." },
    { id: 'h1_6', transcript: "They told wild tales to frighten him." },
    { id: 'h1_7', transcript: "We find joy in the simplest things." },
    { id: 'h1_8', transcript: "The puppy chewed up the new shoes." },
    { id: 'h1_9', transcript: "A smooth road makes driving pleasant." },
    { id: 'h1_10', transcript: "The quick brown fox jumps over the lazy dog." }
];

export const getGoldenTranscript = (): string => {
    return HARVARD_SENTENCES.map(s => s.transcript).join(' ');
};

export const HARVARD_FULL = getGoldenTranscript();
export const HARVARD_LIST_1_SENTENCES = HARVARD_SENTENCES.map(s => s.transcript);

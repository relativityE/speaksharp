// Shared PDF text extraction for proofs that assert what a generated artifact does and does not carry.
//
// Extracted from tests/e2e/progress-cross-page.e2e.spec.ts so the e2e suite and the #1306 production
// proof read artifacts the SAME way. This matters for absence claims: a raw-byte search over PDF
// bytes is format-dependent — jsPDF may compress or split a string across text-run operators, so a
// marker that IS present can read as absent, turning "the expired transcript is not in the artifact"
// into a claim that passes for the wrong reason. Parsing the text layer removes that failure mode.
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Extract the concatenated text layer of every page, one page per line. */
export async function extractPdfText(path: string): Promise<string> {
    const data = new Uint8Array(await readFile(path));
    const pdf = await getDocument({ data }).promise;
    const chunks: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        chunks.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
    }
    return chunks.join('\n');
}

/**
 * Normalise extracted text for containment checks. The text layer preserves the visual run breaks
 * rather than the source string, so a phrase can arrive with collapsed or extra whitespace; comparing
 * raw would produce false "absent" results on text that is plainly there.
 */
export function normalizeForMatch(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

/**
 * #1436 P2 — CANONICALISATION STRONG ENOUGH FOR A LEAK TEST.
 *
 * `normalizeForMatch` only collapses whitespace. Using it to prove a transcript is ABSENT from a PDF
 * makes the proof pass on every representation the leak could actually take: different case, composed
 * vs decomposed Unicode, ligatures, and — the one that matters most for PDFs — text runs that split a
 * word across extraction boundaries, so `rehearsal` arrives as `rehe arsal`.
 *
 * An absence test is only as strong as its weakest normalisation: anything it cannot canonicalise is a
 * form the leaked text can hide in. This folds case, applies NFKD and strips combining marks, reduces
 * to letters and digits only, and REMOVES separators entirely so intra-word splits cannot hide a
 * match. It is deliberately lossier than a display normaliser — it exists to make hiding hard, not to
 * render text.
 */
export function canonicalizeForLeakCheck(text: string): string {
    return text
        .normalize('NFKD')
        .replace(/\p{M}+/gu, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '');
}

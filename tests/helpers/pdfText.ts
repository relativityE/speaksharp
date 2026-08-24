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

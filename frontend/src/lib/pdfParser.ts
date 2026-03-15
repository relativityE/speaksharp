import * as pdfjsLib from 'pdfjs-dist';

// Configure the worker explicitly to ensure off-main-thread parsing.
// The path corresponds to the destination in viteStaticCopy.
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';

/**
 * Extracts text from a PDF file using pdfjs-dist.
 * 
 * @param {File} file - The PDF file to parse.
 * @returns {Promise<string>} The extracted text.
 */
export const extractTextFromPdf = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    const pagePromises = Array.from({ length: pdf.numPages }, async (_, i) => {
        const pageNum = i + 1;
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        return textContent.items
            .map((item) => ('str' in item ? (item as { str: string }).str : ''))
            .join(' ');
    });

    const pagesText = await Promise.all(pagePromises);
    const fullText = pagesText.join('\n');

    return fullText.trim();
};

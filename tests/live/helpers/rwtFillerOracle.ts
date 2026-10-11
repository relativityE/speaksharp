/**
 * #1258 RWT (run 38104864048, F2): the filler oracle recounts a saved transcript with the PRODUCT'S OWN definition.
 *
 * The product saves `flattenToFillerCounts(countFillerWords(finalTranscript))` (SpeechRuntimeController
 * `finalizedFillerData` → `filler_counts`), whose keys cover variants (e.g. "um" = um|umm|ummm|uhm). A literal-word
 * regex disagreed with it whenever the recogniser wrote a variant, which read as a saved-count defect. One definition on both sides keeps "transcript vs saved" an integrity
 * check and "vs corpus" a recognition check. Counted in Node from the saved row; never stored in a receipt.
 */
import { countFillerWords } from '../../../frontend/src/utils/fillerWordUtils';
import { flattenToFillerCounts } from '../../../frontend/src/utils/nextAction';

/** The product's count for one persisted `filler_counts` key (e.g. `you_know`) in `transcript`; 0 when absent. */
export const productFillerCount = (transcript: string, key: string): number =>
    (flattenToFillerCounts(countFillerWords(transcript)) as Record<string, number>)[key] ?? 0;

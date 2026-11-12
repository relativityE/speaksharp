/** Stable in-page anchor for a legal section, e.g. "Service Providers" -> "service-providers" (linked from the review card). */
export const legalSectionId = (heading: string) => heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

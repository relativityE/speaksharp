/**
 * Performs a constant-time comparison of two strings to prevent timing attacks.
 * This is crucial for verifying secrets/tokens where the time taken to compare
 * should not depend on how many characters match.
 * 
 * ⚠️ IMPORTANT: We avoid early returns on length mismatch because that leaks 
 * information about the secret length. We always iterate over the maximum 
 * possible length.
 * 
 * @param a The first string (e.g., the correct secret)
 * @param b The second string (e.g., the user input)
 * @returns Promise<boolean> True if strings match, false otherwise
 */
export async function safeCompare(a: string, b: string): Promise<boolean> {
    const encoder = new TextEncoder();
    const bufA = encoder.encode(a);
    const bufB = encoder.encode(b);

    const maxLength = Math.max(bufA.byteLength, bufB.byteLength);

    // Start with 0 if lengths match, 1 otherwise
    let result = bufA.byteLength === bufB.byteLength ? 0 : 1;

    // Iterate over the maximum length. Use XOR to check for differences.
    // If indices are out of bounds, we XOR with 0 (or any constant).
    for (let i = 0; i < maxLength; i++) {
        const charA = bufA[i] || 0;
        const charB = bufB[i] || 0;
        result |= charA ^ charB;
    }

    return result === 0;
}

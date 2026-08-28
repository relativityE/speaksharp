/**
 * #1304 — types for the archive verifier, so `typecheck:evidence` can check the contract its tests
 * import. The implementation is `.mjs` because it runs directly under node with no build step.
 */
export type VerifyFailureReason =
    | 'missing_file'
    | 'byte_count_mismatch'
    | 'official_md5_mismatch'
    | 'pinned_sha256_mismatch';

export type VerifyResult =
    | { ok: true; name: string; bytes: number; md5: string; sha256: string; pinnedSha256Checked: boolean }
    | { ok: false; reason: VerifyFailureReason; detail: string };

/** OpenSLR SLR12 official MD5s, read from the publisher's own `md5sum.txt`. */
export const OFFICIAL_MD5: Record<string, string>;
/** Byte counts read from the server's Content-Length. */
export const EXPECTED_BYTES: Record<string, number>;
/** SpeakSharp SHA-256 pins — empty until an operator commits values from a verified fetch. */
export const PINNED_SHA256: Record<string, string>;

export function hashFile(path: string, algorithm: string): Promise<string>;

/**
 * Verify one archive in layers: byte count, then the PUBLISHER's MD5, then our SHA-256 pin.
 * Order matters — a SHA-256 computed before the official MD5 passes would pin whatever arrived.
 */
export function verifyArchive(args: {
    path: string;
    name: string;
    expectedBytes?: number;
    expectedMd5?: string;
    pinnedSha256?: string;
}): Promise<VerifyResult>;

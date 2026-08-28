/**
 * #1304 — types for the archive verifier, so `typecheck:evidence` can check the contract its tests
 * import. The implementation is `.mjs` because it runs directly under node with no build step.
 */
export type VerifyMode = 'bootstrap' | 'pinned';

export type VerifyFailureReason =
    | 'unknown_mode'
    | 'unknown_archive'
    | 'incomplete_expectations'
    | 'missing_sha256_pin'
    | 'missing_file'
    | 'byte_count_mismatch'
    | 'official_md5_mismatch'
    | 'pinned_sha256_mismatch';

export type VerifyResult =
    | {
          ok: true;
          name: string;
          mode: VerifyMode;
          bytes: number;
          md5: string;
          sha256: string;
          pinnedSha256Checked: boolean;
      }
    | { ok: false; reason: VerifyFailureReason; detail: string };

/** OpenSLR SLR12 official MD5s, read from the publisher's own `md5sum.txt`. */
export const OFFICIAL_MD5: Record<string, string>;
/** Byte counts read from the server's Content-Length. */
export const EXPECTED_BYTES: Record<string, number>;
/** SpeakSharp SHA-256 pins, committed from a bootstrap fetch that passed the publisher's MD5 first. */
export const PINNED_SHA256: Record<string, string>;

export function hashFile(path: string, algorithm: string): Promise<string>;

/**
 * The verification core, over a COMPLETE expectation record. Every layer is required; an incomplete
 * record is a named failure rather than a skipped check. Exposed so tests can drive the layer order
 * over small fixtures — the fetch path uses `verifyArchive`, which accepts no expectations.
 *
 * `sha256` is required in `'pinned'` mode and ignored in `'bootstrap'`, which is the ONLY thing
 * bootstrap relaxes.
 */
export function verifyAgainstExpectations(args: {
    path: string;
    name: string;
    mode: VerifyMode;
    expected: { bytes?: number; md5?: string; sha256?: string };
}): Promise<VerifyResult>;

/**
 * Verify one NAMED archive against the committed tables. Takes no expectations, by design: there is
 * no argument shape in which a caller can verify against numbers it produced itself. An unknown name
 * fails rather than passing vacuously.
 */
export function verifyArchive(args: {
    path: string;
    name: string;
    mode?: VerifyMode;
}): Promise<VerifyResult>;

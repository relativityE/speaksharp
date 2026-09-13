// #1432 PM decision A — types for the trusted Node authorization verifier.
//
// The live project compiles with `allowJs: false`, so importing the `.mjs` verifier from a live spec would
// otherwise resolve to `any` and silently disable checking at the call site. Declared beside the module.
import type { KeyObject } from 'node:crypto';

export declare const MODEL_COMPARISON_AUTH_VERSION: string;
export declare const MODEL_COMPARISON_MAX_TTL_MS: number;
export declare const MODEL_COMPARISON_CLOCK_SKEW_MS: number;

export interface AuthorizationPayload {
    version: string;
    releaseSha: string;
    origin: string;
    nonce: string;
    candidateId: string;
    journey: string;
    evidenceDocumentId: string;
    issuedAt: string;
    expiresAt: string;
}
export interface SignedAuthorization { payload: AuthorizationPayload; signature: string }
export interface AuthorizationRecord {
    envelope: SignedAuthorization;
    envelopeSha256: string;
    verificationKeyFingerprint: string;
    verifiedAt: string;
    expiredAtVerification: false;
    verified: {
        candidateId: string;
        journey: string;
        releaseSha: string;
        origin: string;
        evidenceDocumentId: string;
        comparisonNonce: string;
    };
}

export declare function authorizationPayloadBytes(payload: unknown): Buffer;
export declare function authorizationEnvelopeSha256(envelope: unknown): string;
export declare function parsePinnedPublicKey(rawBase64: unknown): { key: KeyObject; fingerprint: string };
export declare function verifyModelComparisonAuthorization(input: {
    envelope: unknown;
    publicKey: unknown;
    expected?: Record<string, unknown>;
    now?: number;
}): { ok: boolean; problems: string[]; record: AuthorizationRecord | null };
export declare function validateAuthorizationRecord(record: unknown, context: {
    publicKey: unknown;
    row: unknown;
    releaseSha: unknown;
    origin: unknown;
    evidenceDocumentId: unknown;
}): string[];

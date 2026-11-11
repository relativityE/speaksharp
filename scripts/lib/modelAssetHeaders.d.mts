/** Types for modelAssetHeaders.mjs, which stays plain ESM because Vite's config and the E2E server load it directly. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

export const MODEL_ASSET_PREFIX: '/models/';
export const MODEL_ASSET_CONTENT_TYPES: Readonly<Record<string, string>>;
export const MODEL_ASSET_EXTENSIONLESS_TYPE: string;
export const MODEL_ASSET_FALLBACK_TYPE: string;
export type ModelAssetGuard = { root?: string | null; modelDirs?: readonly string[] };
export type ModelAssetResponseHeaders = { 'Content-Type': string; 'X-Content-Type-Options': 'nosniff' };
export function modelAssetHeaders(url: string, guard?: ModelAssetGuard): ModelAssetResponseHeaders | null;
export function modelAssetHeadersMiddleware(
    guard?: ModelAssetGuard,
): (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => void;
export function modelAssetHeadersPlugin(): Plugin;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deepLinkLanding = exports.wireErrorCode = void 0;
exports.classifyTokenResponse = classifyTokenResponse;
const nonEmpty = (value) => typeof value === 'string' && value.length > 0;
const record = (value) => typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
const inconclusive = (status, reason) => ({ kind: 'inconclusive', status, reason });
// Pinned @supabase/auth-js 2.86.0, lib/helpers.js parseResponseAPIVersion and lib/fetch.js handleError.
const API_VERSION_REGEX = /^2[0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|1[0-9]|2[0-9]|3[0-1])$/i;
const API_VERSION_2024_01_01 = Date.parse('2024-01-01T00:00:00.0Z');
/** The error code exactly as the pinned client reads it: `code` from a 2024-01-01+ response, otherwise `error_code`. */
const wireErrorCode = (apiVersion, body) => {
    const data = record(body);
    if (!data)
        return undefined;
    const version = apiVersion && API_VERSION_REGEX.test(apiVersion) ? Date.parse(`${apiVersion}T00:00:00.0Z`) : NaN;
    if (version >= API_VERSION_2024_01_01 && typeof data.code === 'string')
        return data.code;
    return typeof data.error_code === 'string' ? data.error_code : undefined;
};
exports.wireErrorCode = wireErrorCode;
/** One `/auth/v1/token?grant_type=password` response, classified. A session needs the typed, non-empty fields. */
function classifyTokenResponse({ status, apiVersion, body }) {
    if (status === 200) {
        if (!body.readable)
            return inconclusive(status, 'unreadable_body');
        const data = record(body.value);
        const user = record(data?.user);
        const session = data !== null && nonEmpty(data.access_token) && nonEmpty(data.refresh_token)
            && typeof data.expires_in === 'number' && data.expires_in > 0;
        if (!session || !user || !nonEmpty(user.id))
            return inconclusive(status, 'malformed_session');
        return { kind: 'token_ok', status, userId: user.id };
    }
    if (status === 429)
        return inconclusive(status, 'rate_limited');
    if (status >= 500)
        return inconclusive(status, 'server_error');
    if (!body.readable)
        return inconclusive(status, 'unreadable_body');
    if (status === 400 && (0, exports.wireErrorCode)(apiVersion, body.value) === 'invalid_credentials')
        return { kind: 'invalid_credentials', status };
    return inconclusive(status, 'unrecognized_error');
}
/** G04: the landed URL against the deep link's exact pathname, query and hash, each compared whole. */
const deepLinkLanding = (url, expected) => ({
    pathnameMatches: url.pathname === expected.pathname,
    searchMatches: url.search === expected.search,
    hashMatches: url.hash === expected.hash,
});
exports.deepLinkLanding = deepLinkLanding;

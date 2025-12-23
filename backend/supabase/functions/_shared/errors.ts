/**
 * Edge Function Error Taxonomy
 * 
 * Standardized error codes and response helpers for consistent error handling
 * across all Supabase Edge Functions.
 */

// Error codes with semantic meaning
export const ErrorCodes = {
    // Authentication (401)
    AUTH_MISSING_HEADER: 'AUTH_MISSING_HEADER',
    AUTH_INVALID_TOKEN: 'AUTH_INVALID_TOKEN',
    AUTH_USER_NOT_FOUND: 'AUTH_USER_NOT_FOUND',

    // Authorization (403)
    AUTHZ_INSUFFICIENT_PERMISSIONS: 'AUTHZ_INSUFFICIENT_PERMISSIONS',

    // Validation (400)
    VALIDATION_MISSING_FIELD: 'VALIDATION_MISSING_FIELD',
    VALIDATION_INVALID_FORMAT: 'VALIDATION_INVALID_FORMAT',
    VALIDATION_MISSING_METADATA: 'VALIDATION_MISSING_METADATA',

    // Resource (404)
    RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
    PROFILE_NOT_FOUND: 'PROFILE_NOT_FOUND',

    // External Service (502)
    STRIPE_API_ERROR: 'STRIPE_API_ERROR',
    STRIPE_WEBHOOK_INVALID: 'STRIPE_WEBHOOK_INVALID',

    // Configuration (500)
    CONFIG_MISSING_ENV: 'CONFIG_MISSING_ENV',

    // Internal (500)
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    DATABASE_ERROR: 'DATABASE_ERROR',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

// Error response interface
export interface ErrorResponse {
    error: {
        code: ErrorCode;
        message: string;
        details?: Record<string, unknown>;
    };
}

// Map error codes to HTTP status
const errorCodeToStatus: Record<ErrorCode, number> = {
    [ErrorCodes.AUTH_MISSING_HEADER]: 401,
    [ErrorCodes.AUTH_INVALID_TOKEN]: 401,
    [ErrorCodes.AUTH_USER_NOT_FOUND]: 401,
    [ErrorCodes.AUTHZ_INSUFFICIENT_PERMISSIONS]: 403,
    [ErrorCodes.VALIDATION_MISSING_FIELD]: 400,
    [ErrorCodes.VALIDATION_INVALID_FORMAT]: 400,
    [ErrorCodes.VALIDATION_MISSING_METADATA]: 400,
    [ErrorCodes.RESOURCE_NOT_FOUND]: 404,
    [ErrorCodes.PROFILE_NOT_FOUND]: 404,
    [ErrorCodes.STRIPE_API_ERROR]: 502,
    [ErrorCodes.STRIPE_WEBHOOK_INVALID]: 400,
    [ErrorCodes.CONFIG_MISSING_ENV]: 500,
    [ErrorCodes.INTERNAL_ERROR]: 500,
    [ErrorCodes.DATABASE_ERROR]: 500,
};

/**
 * Create a standardized error response
 */
export function createErrorResponse(
    code: ErrorCode,
    message: string,
    corsHeaders: Record<string, string>,
    details?: Record<string, unknown>
): Response {
    const status = errorCodeToStatus[code] || 500;
    const body: ErrorResponse = {
        error: {
            code,
            message,
            ...(details && { details }),
        },
    };

    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

/**
 * Create a standardized success response
 */
export function createSuccessResponse<T>(
    data: T,
    corsHeaders: Record<string, string>,
    status = 200
): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

/**
 * Custom error class for typed errors
 */
export class EdgeFunctionError extends Error {
    constructor(
        public code: ErrorCode,
        message: string,
        public details?: Record<string, unknown>
    ) {
        super(message);
        this.name = 'EdgeFunctionError';
    }
}

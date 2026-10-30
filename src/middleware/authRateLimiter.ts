import type { RequestHandler } from 'express';
import { rateLimit, type Options } from 'express-rate-limit';

export const AUTH_RATE_LIMIT_OPTIONS = {
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
} as const satisfies Partial<Options>;

// Each call returns a limiter with its own in-memory store, so every auth endpoint is counted independently.
export function createAuthRateLimiter(overrides: Partial<Options> = {}): RequestHandler {
    return rateLimit({ ...AUTH_RATE_LIMIT_OPTIONS, ...overrides });
}

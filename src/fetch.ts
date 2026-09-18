/**
 * Small HTTP helper built on got-scraping: browser-like headers, redirects, timeouts, gzip handling and
 * error categorisation. Kept free of Actor dependencies so it can be swapped for a fake in tests.
 */
import { gunzipSync } from 'node:zlib';

import { gotScraping } from 'got-scraping';

export type ErrorType =
    'invalid-url' | 'dns' | 'timeout' | 'blocked' | 'http-error' | 'network' | 'not-found' | 'invalid-feed' | 'other';

export interface FetchResult {
    ok: true;
    url: string;
    finalUrl: string;
    statusCode: number;
    contentType: string;
    body: string;
}

export interface FetchFailure {
    ok: false;
    url: string;
    statusCode?: number;
    errorType: ErrorType;
    error: string;
}

export type FetchOutcome = FetchResult | FetchFailure;

export type Fetcher = (url: string) => Promise<FetchOutcome>;

const MAX_BODY_BYTES = 32 * 1024 * 1024;

export function categorizeError(message: string, statusCode?: number): ErrorType {
    const m = message.toLowerCase();
    if (statusCode === 403 || statusCode === 429 || m.includes('blocked') || m.includes('captcha')) return 'blocked';
    if (statusCode === 404 || statusCode === 410) return 'not-found';
    if (statusCode && statusCode >= 400) return 'http-error';
    if (m.includes('enotfound') || m.includes('getaddrinfo') || m.includes('dns')) return 'dns';
    if (m.includes('timeout') || m.includes('timed out') || m.includes('etimedout')) return 'timeout';
    if (
        m.includes('econnrefused') ||
        m.includes('econnreset') ||
        m.includes('socket') ||
        m.includes('tls') ||
        m.includes('certificate') ||
        m.includes('epipe') ||
        m.includes('network')
    )
        return 'network';
    return 'other';
}

function isGzip(buffer: Buffer): boolean {
    return buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

/** Decompresses a raw gzip body (served without Content-Encoding) and decodes it as UTF-8. */
export function decodeBody(buffer: Buffer): string {
    let bytes = buffer;
    if (isGzip(bytes)) bytes = gunzipSync(bytes, { maxOutputLength: MAX_BODY_BYTES });
    if (bytes.length > MAX_BODY_BYTES) bytes = bytes.subarray(0, MAX_BODY_BYTES);
    return bytes.toString('utf8');
}

export interface FetcherOptions {
    timeoutMs?: number;
    proxyUrl?: string;
    retries?: number;
}

export function createFetcher(options: FetcherOptions = {}): Fetcher {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const retries = options.retries ?? 1;
    return async (url: string): Promise<FetchOutcome> => {
        let attempt = 0;
        let last: FetchFailure = { ok: false, url, errorType: 'other', error: 'Unknown error' };
        while (attempt <= retries) {
            attempt += 1;
            try {
                const response = await gotScraping({
                    url,
                    responseType: 'buffer',
                    timeout: { request: timeoutMs },
                    retry: { limit: 0 },
                    throwHttpErrors: false,
                    followRedirect: true,
                    maxRedirects: 10,
                    proxyUrl: options.proxyUrl,
                    headers: {
                        accept: 'application/rss+xml,application/atom+xml,application/feed+json,application/json,application/xml,text/xml;q=0.9,text/html;q=0.8,*/*;q=0.7',
                    },
                    https: { rejectUnauthorized: false },
                });
                const { statusCode } = response;
                if (statusCode >= 400) {
                    last = {
                        ok: false,
                        url,
                        statusCode,
                        errorType: categorizeError(`HTTP ${statusCode}`, statusCode),
                        error: `HTTP ${statusCode} ${response.statusMessage ?? ''}`.trim(),
                    };
                    if (statusCode < 500 && statusCode !== 429) return last;
                    continue;
                }
                const contentType = String(response.headers['content-type'] ?? '').toLowerCase();
                const body = decodeBody(response.rawBody as Buffer);
                return { ok: true, url, finalUrl: response.url ?? url, statusCode, contentType, body };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                const errorType = categorizeError(message);
                last = { ok: false, url, errorType, error: message.slice(0, 500) };
                if (errorType === 'dns' || errorType === 'blocked') return last;
            }
        }
        return last;
    };
}

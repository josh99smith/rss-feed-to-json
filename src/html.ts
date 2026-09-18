/**
 * HTML helpers: strip tags, convert HTML fragments into readable plain text, discover feed links.
 */
import { load } from 'cheerio';
import { decodeHTML } from 'entities';

const BLOCK_END =
    /<\/(p|div|li|h[1-6]|tr|blockquote|pre|section|article|header|footer|ul|ol|table|dd|dt|figure|figcaption)\s*>/gi;
const BR = /<br\s*\/?>/gi;

/** Removes tags without any layout awareness (for titles and one-liners). */
export function stripTags(html: string): string {
    return html.replace(/<[^>]*>/g, '');
}

/** Converts an HTML fragment into plain text with paragraph breaks, capped at `maxChars`. */
export function htmlToText(html: string | null, maxChars = 5000): string | null {
    if (!html) return null;
    const withBreaks = html.replace(BR, '\n').replace(BLOCK_END, '\n');
    const $ = load(withBreaks, null, false);
    $('script, style, noscript, iframe, svg').remove();
    const text = $.root()
        .text()
        .replace(/\u00a0/g, ' ')
        .split('\n')
        .map((line) => line.replace(/[ \t\r\f\v]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    if (!text) return null;
    return truncate(text, maxChars);
}

export function truncate(value: string | null, maxChars: number): string | null {
    if (value === null) return null;
    return value.length > maxChars ? value.slice(0, maxChars) : value;
}

const FEED_TYPES = new Set([
    'application/rss+xml',
    'application/atom+xml',
    'application/feed+json',
    'application/json',
    'application/rdf+xml',
    'text/xml',
    'application/xml',
]);

export const COMMON_FEED_PATHS = [
    '/feed',
    '/rss',
    '/feed.xml',
    '/rss.xml',
    '/atom.xml',
    '/index.xml',
    '/feed/',
    '/rss/',
    '/feeds/posts/default',
    '/feed.json',
];

/**
 * Finds feed URLs advertised by a web page via `<link rel="alternate" type="application/rss+xml|atom+xml|feed+json">`.
 * Returns absolute URLs in document order, without duplicates.
 */
export function discoverFeedLinks(html: string, pageUrl: string): string[] {
    const $ = load(html);
    const out: string[] = [];
    const seen = new Set<string>();
    $('link[rel][href]').each((_, el) => {
        const rel = ($(el).attr('rel') ?? '').toLowerCase().split(/\s+/);
        const type = ($(el).attr('type') ?? '').toLowerCase().split(';')[0].trim();
        const href = $(el).attr('href');
        if (!href) return;
        const isAlternateFeed = rel.includes('alternate') && FEED_TYPES.has(type);
        const isFeedRel = rel.includes('feed');
        if (!isAlternateFeed && !isFeedRel) return;
        if (type === 'application/json' && !rel.includes('alternate')) return;
        try {
            const url = new URL(decodeHTML(href), pageUrl);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
            const key = url.toString();
            if (seen.has(key)) return;
            seen.add(key);
            out.push(key);
        } catch {
            // ignore unparsable hrefs
        }
    });
    return out;
}

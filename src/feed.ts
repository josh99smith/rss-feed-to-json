/**
 * Pure feed parsing: RSS 2.0, Atom 1.0, RSS 1.0 (RDF) and JSON Feed 1.x are normalised into one item
 * shape. No network access here so everything is unit-testable with inline fixtures.
 */
import { decodeHTML } from 'entities';
import { XMLParser } from 'fast-xml-parser';

import { htmlToText, stripTags } from './html.js';

export type FeedType = 'rss' | 'atom' | 'rss1' | 'json';

export interface Enclosure {
    url: string;
    type: string | null;
    length: number | null;
}

export interface FeedItem {
    id: string | null;
    title: string | null;
    url: string | null;
    author: string | null;
    publishedAt: string | null;
    updatedAt: string | null;
    summary: string | null;
    contentHtml: string | null;
    categories: string[];
    enclosures: Enclosure[];
    imageUrl: string | null;
}

export interface ParsedFeed {
    ok: true;
    feedType: FeedType;
    feedTitle: string | null;
    /** The website the feed belongs to, when the feed declares one. */
    siteUrl: string | null;
    items: FeedItem[];
}

export interface FeedParseError {
    ok: false;
    /** `html` when the document is a web page (feed discovery should be attempted), `invalid` otherwise. */
    reason: 'html' | 'invalid' | 'empty';
    error: string;
}

export type FeedParseResult = ParsedFeed | FeedParseError;

type XmlNode = Record<string, unknown>;

const ARRAY_TAGS = new Set([
    'item',
    'entry',
    'category',
    'enclosure',
    'link',
    'author',
    'contributor',
    'media:content',
    'media:thumbnail',
    'media:group',
    'dc:subject',
    'dc:creator',
]);

// Elements whose inner markup must be kept verbatim (HTML/XHTML payloads).
const STOP_NODES = [
    'rss.channel.item.description',
    'rss.channel.item.content:encoded',
    'rss.channel.item.content',
    'feed.entry.content',
    'feed.entry.summary',
    'rdf:RDF.item.description',
    'rdf:RDF.item.content:encoded',
];

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    removeNSPrefix: false,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    cdataPropName: false,
    processEntities: true,
    htmlEntities: true,
    ignoreDeclaration: true,
    ignorePiTags: true,
    stopNodes: STOP_NODES,
    isArray: (tagName) => ARRAY_TAGS.has(tagName),
});

// ---------- generic helpers ----------

function asArray<T>(value: T | T[] | undefined | null): T[] {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
}

function isObject(value: unknown): value is XmlNode {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Text content of a node: strings, `{ '#text': ... }` objects, arrays (first element). */
function textOf(node: unknown): string | null {
    if (node === undefined || node === null) return null;
    if (typeof node === 'string') return node.trim() || null;
    if (typeof node === 'number' || typeof node === 'boolean') return String(node);
    if (Array.isArray(node)) return textOf(node[0]);
    if (isObject(node)) return textOf(node['#text']);
    return null;
}

function attr(node: unknown, name: string): string | null {
    if (!isObject(node)) return null;
    const value = node[`@_${name}`];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** First defined child among several (namespace-prefixed and plain) names. */
function pick(node: XmlNode | undefined, ...names: string[]): unknown {
    if (!node) return undefined;
    for (const name of names) {
        const value = node[name];
        if (value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
}

/**
 * Turns the raw inner markup of a stop node into HTML: CDATA sections are kept verbatim, everything
 * else is entity-decoded (the feed escaped its HTML).
 */
export function rawToHtml(raw: string | null): string | null {
    if (raw === null || raw === undefined) return null;
    const value = raw.trim();
    if (!value) return null;
    const parts: string[] = [];
    const re = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
    let last = 0;
    let match: RegExpExecArray | null = re.exec(value);
    while (match) {
        if (match.index > last) parts.push(decodeHTML(value.slice(last, match.index)));
        parts.push(match[1]);
        last = match.index + match[0].length;
        match = re.exec(value);
    }
    if (last < value.length) parts.push(decodeHTML(value.slice(last)));
    const html = parts.join('').trim();
    return html || null;
}

/** Content of a stop node that may carry attributes (Atom `<content type="html">`). */
function stopNodeHtml(node: unknown): string | null {
    if (node === undefined || node === null) return null;
    if (Array.isArray(node)) return stopNodeHtml(node[0]);
    if (typeof node === 'string') return rawToHtml(node);
    if (isObject(node)) {
        const type = (attr(node, 'type') ?? '').toLowerCase();
        const raw = typeof node['#text'] === 'string' ? node['#text'] : null;
        if (raw === null) return null;
        if (type === 'xhtml') return raw.trim() || null; // already real markup
        if (type === 'text') {
            const text = rawToHtml(raw);
            return text ? escapeHtml(text) : null;
        }
        return rawToHtml(raw);
    }
    return null;
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Parses RFC 822 / ISO 8601 / loose dates to ISO 8601, or null when unparsable. */
export function normalizeDate(value: string | null | undefined): string | null {
    if (!value) return null;
    let v = value.trim();
    if (!v) return null;
    // Common non-standard zone names Date.parse does not understand.
    v = v.replace(/\s(UT|Z)$/i, ' +0000').replace(/\s(PDT|PST|EDT|EST|CDT|CST|MDT|MST)$/i, (_m, zone: string) => {
        const offsets: Record<string, string> = {
            PDT: '-0700',
            PST: '-0800',
            EDT: '-0400',
            EST: '-0500',
            CDT: '-0500',
            CST: '-0600',
            MDT: '-0600',
            MST: '-0700',
        };
        return ` ${offsets[zone.toUpperCase()] ?? '+0000'}`;
    });
    const ms = Date.parse(v);
    if (Number.isNaN(ms)) return null;
    return new Date(ms).toISOString();
}

export function resolveUrl(value: string | null | undefined, base: string): string | null {
    if (!value) return null;
    try {
        const url = new URL(value.trim(), base);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        return url.toString();
    } catch {
        return null;
    }
}

function parseLength(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = typeof value === 'number' ? value : Number.parseInt(value, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

function cleanTitle(value: string | null): string | null {
    if (!value) return null;
    const text = stripTags(decodeHTML(value)).replace(/\s+/g, ' ').trim();
    return text || null;
}

function cleanAuthor(value: string | null): string | null {
    if (!value) return null;
    const v = decodeHTML(value).trim();
    // RSS <author> is "email (Name)" by spec; keep the human-readable part.
    const paren = /^[^\s@]+@[^\s@]+\s*\((.+)\)$/.exec(v);
    if (paren) return paren[1].trim() || null;
    return stripTags(v).replace(/\s+/g, ' ').trim() || null;
}

function firstImageInHtml(html: string | null): string | null {
    if (!html) return null;
    const match = /<img[^>]+src\s*=\s*["']([^"']+)["']/i.exec(html);
    return match ? match[1] : null;
}

function addEnclosure(
    list: Enclosure[],
    url: string | null,
    type: string | null,
    length: string | number | null | undefined,
): void {
    if (!url) return;
    if (list.some((e) => e.url === url)) return;
    list.push({ url, type: type ? type.toLowerCase() : null, length: parseLength(length) });
}

function mediaEnclosures(node: XmlNode, base: string, list: Enclosure[]): string | null {
    let image: string | null = null;
    const groups = [node, ...asArray(node['media:group'] as XmlNode[] | undefined)];
    for (const group of groups) {
        if (!isObject(group)) continue;
        for (const media of asArray(group['media:content'] as XmlNode[] | undefined)) {
            const url = resolveUrl(attr(media, 'url'), base);
            const type = attr(media, 'type');
            const medium = attr(media, 'medium');
            addEnclosure(list, url, type, attr(media, 'fileSize'));
            if (!image && url && (medium === 'image' || type?.startsWith('image/'))) image = url;
        }
        for (const thumb of asArray(group['media:thumbnail'] as XmlNode[] | undefined)) {
            const url = resolveUrl(attr(thumb, 'url'), base);
            if (!image && url) image = url;
        }
    }
    const itunesImage = resolveUrl(attr(node['itunes:image'], 'href') ?? textOf(node['itunes:image']), base);
    if (!image && itunesImage) image = itunesImage;
    return image;
}

function dedupe(values: (string | null)[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const v of values) {
        const clean = v?.replace(/\s+/g, ' ').trim();
        if (!clean) continue;
        const key = clean.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(clean);
    }
    return out;
}

// ---------- RSS 2.0 ----------

function parseRssItem(item: XmlNode, base: string, feedAuthor: string | null): FeedItem {
    const contentHtml = stopNodeHtml(pick(item, 'content:encoded', 'content'));
    const description = stopNodeHtml(item.description);
    const guid = textOf(item.guid);
    const url = resolveUrl(textOf(item.link) ?? (attr(item.guid, 'isPermaLink') === 'true' ? guid : null), base);
    const enclosures: Enclosure[] = [];
    for (const enc of asArray(item.enclosure as XmlNode[] | undefined)) {
        addEnclosure(enclosures, resolveUrl(attr(enc, 'url'), base), attr(enc, 'type'), attr(enc, 'length'));
    }
    const mediaImage = mediaEnclosures(item, base, enclosures);
    const imageEnclosure = enclosures.find((e) => e.type?.startsWith('image/'))?.url ?? null;

    const summary = description ? htmlToText(description, 2000) : null;
    return {
        id: guid ?? url,
        title: cleanTitle(textOf(item.title)),
        url,
        author: cleanAuthor(textOf(pick(item, 'dc:creator', 'author', 'itunes:author')) ?? feedAuthor),
        publishedAt: normalizeDate(textOf(pick(item, 'pubDate', 'dc:date', 'published'))),
        updatedAt: normalizeDate(textOf(pick(item, 'atom:updated', 'updated', 'lastBuildDate'))),
        summary,
        contentHtml: contentHtml ?? description,
        categories: dedupe(asArray(item.category as unknown[]).map((c) => textOf(c))),
        enclosures,
        imageUrl: mediaImage ?? imageEnclosure ?? firstImageInHtml(contentHtml ?? description),
    };
}

function parseRss(doc: XmlNode, base: string): ParsedFeed {
    const rss = doc.rss as XmlNode;
    const channel = (isObject(rss.channel) ? rss.channel : {}) as XmlNode;
    const feedAuthor = textOf(pick(channel, 'itunes:author', 'managingEditor', 'dc:creator'));
    const items = asArray(channel.item as XmlNode[] | undefined)
        .filter(isObject)
        .map((item) => parseRssItem(item, base, feedAuthor));
    return {
        ok: true,
        feedType: 'rss',
        feedTitle: cleanTitle(textOf(channel.title)),
        siteUrl: resolveUrl(textOf(asArray(channel.link).find((l) => typeof l === 'string') ?? channel.link), base),
        items,
    };
}

// ---------- Atom ----------

function atomLinks(node: XmlNode): XmlNode[] {
    return asArray(node.link as unknown[])
        .map((l) => (typeof l === 'string' ? { '@_href': l } : l))
        .filter(isObject);
}

function atomAlternate(node: XmlNode, base: string): string | null {
    const links = atomLinks(node);
    const html = links.find(
        (l) => (attr(l, 'rel') ?? 'alternate') === 'alternate' && (attr(l, 'type') ?? 'text/html').includes('html'),
    );
    const alternate = links.find((l) => (attr(l, 'rel') ?? 'alternate') === 'alternate');
    const any = links.find((l) => attr(l, 'href'));
    return resolveUrl(attr(html ?? alternate ?? any, 'href'), base);
}

function atomPerson(node: unknown): string | null {
    const first = asArray(node as unknown[])[0];
    if (!first) return null;
    if (typeof first === 'string') return cleanAuthor(first);
    if (isObject(first)) return cleanAuthor(textOf(first.name) ?? textOf(first.email) ?? textOf(first));
    return null;
}

function parseAtomEntry(entry: XmlNode, base: string, feedAuthor: string | null): FeedItem {
    const contentHtml = stopNodeHtml(entry.content);
    const summaryHtml = stopNodeHtml(entry.summary);
    const enclosures: Enclosure[] = [];
    for (const link of atomLinks(entry)) {
        if (attr(link, 'rel') === 'enclosure')
            addEnclosure(enclosures, resolveUrl(attr(link, 'href'), base), attr(link, 'type'), attr(link, 'length'));
    }
    const mediaImage = mediaEnclosures(entry, base, enclosures);
    const imageEnclosure = enclosures.find((e) => e.type?.startsWith('image/'))?.url ?? null;
    const url = atomAlternate(entry, base);
    const html = contentHtml ?? summaryHtml;
    return {
        id: textOf(entry.id) ?? url,
        title: cleanTitle(textOf(entry.title)),
        url,
        author: atomPerson(entry.author) ?? feedAuthor,
        publishedAt: normalizeDate(
            textOf(pick(entry, 'published', 'issued', 'created', 'dc:date')) ??
                textOf(pick(entry, 'updated', 'modified')),
        ),
        updatedAt: normalizeDate(textOf(pick(entry, 'updated', 'modified'))),
        summary: summaryHtml ? htmlToText(summaryHtml, 2000) : null,
        contentHtml: html,
        categories: dedupe(
            asArray(entry.category as unknown[]).map((c) => attr(c, 'label') ?? attr(c, 'term') ?? textOf(c)),
        ),
        enclosures,
        imageUrl: mediaImage ?? imageEnclosure ?? firstImageInHtml(html),
    };
}

function parseAtom(doc: XmlNode, base: string): ParsedFeed {
    const feed = doc.feed as XmlNode;
    const feedAuthor = atomPerson(feed.author);
    const items = asArray(feed.entry as XmlNode[] | undefined)
        .filter(isObject)
        .map((entry) => parseAtomEntry(entry, base, feedAuthor));
    return {
        ok: true,
        feedType: 'atom',
        feedTitle: cleanTitle(textOf(feed.title)),
        siteUrl: atomAlternate(feed, base),
        items,
    };
}

// ---------- RSS 1.0 (RDF) ----------

function parseRdf(doc: XmlNode, base: string): ParsedFeed {
    const rdf = doc['rdf:RDF'] as XmlNode;
    const channel = (isObject(rdf.channel) ? rdf.channel : {}) as XmlNode;
    const items = asArray(rdf.item as XmlNode[] | undefined)
        .filter(isObject)
        .map((item): FeedItem => {
            const contentHtml = stopNodeHtml(item['content:encoded']);
            const description = stopNodeHtml(item.description);
            const url = resolveUrl(textOf(item.link) ?? attr(item, 'rdf:about'), base);
            const html = contentHtml ?? description;
            return {
                id: attr(item, 'rdf:about') ?? url,
                title: cleanTitle(textOf(item.title)),
                url,
                author: cleanAuthor(textOf(pick(item, 'dc:creator', 'dc:publisher'))),
                publishedAt: normalizeDate(textOf(pick(item, 'dc:date', 'pubDate'))),
                updatedAt: null,
                summary: description ? htmlToText(description, 2000) : null,
                contentHtml: html,
                categories: dedupe(asArray(item['dc:subject'] as unknown[]).map((c) => textOf(c))),
                enclosures: [],
                imageUrl: firstImageInHtml(html),
            };
        });
    return {
        ok: true,
        feedType: 'rss1',
        feedTitle: cleanTitle(textOf(channel.title)),
        siteUrl: resolveUrl(textOf(channel.link), base),
        items,
    };
}

// ---------- JSON Feed ----------

interface JsonFeedItem {
    id?: string | number;
    url?: string;
    external_url?: string;
    title?: string;
    content_html?: string;
    content_text?: string;
    summary?: string;
    image?: string;
    banner_image?: string;
    date_published?: string;
    date_modified?: string;
    author?: { name?: string };
    authors?: { name?: string }[];
    tags?: string[];
    attachments?: { url?: string; mime_type?: string; size_in_bytes?: number }[];
}

interface JsonFeedDoc {
    version?: string;
    title?: string;
    home_page_url?: string;
    author?: { name?: string };
    authors?: { name?: string }[];
    items?: JsonFeedItem[];
}

function parseJsonFeed(body: string, base: string): FeedParseResult {
    let doc: JsonFeedDoc;
    try {
        doc = JSON.parse(body) as JsonFeedDoc;
    } catch (err) {
        return { ok: false, reason: 'invalid', error: `Invalid JSON: ${(err as Error).message.slice(0, 200)}` };
    }
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.items)) {
        return { ok: false, reason: 'invalid', error: 'JSON document is not a JSON Feed (missing "items" array)' };
    }
    const feedAuthor = doc.authors?.[0]?.name ?? doc.author?.name ?? null;
    const items = doc.items
        .filter((item) => item && typeof item === 'object')
        .map((item): FeedItem => {
            const url = resolveUrl(item.url ?? item.external_url, base);
            const contentHtml =
                item.content_html?.trim() ||
                (item.content_text ? escapeHtml(item.content_text).replace(/\n/g, '<br>') : null) ||
                null;
            const enclosures: Enclosure[] = [];
            for (const att of item.attachments ?? [])
                addEnclosure(enclosures, resolveUrl(att.url, base), att.mime_type ?? null, att.size_in_bytes);
            return {
                id: item.id !== undefined && item.id !== null ? String(item.id) : url,
                title: cleanTitle(item.title ?? null),
                url,
                author: cleanAuthor(item.authors?.[0]?.name ?? item.author?.name ?? feedAuthor),
                publishedAt: normalizeDate(item.date_published),
                updatedAt: normalizeDate(item.date_modified),
                summary: item.summary?.trim() || null,
                contentHtml,
                categories: dedupe(item.tags ?? []),
                enclosures,
                imageUrl: resolveUrl(item.image ?? item.banner_image, base) ?? firstImageInHtml(contentHtml),
            };
        });
    return {
        ok: true,
        feedType: 'json',
        feedTitle: cleanTitle(doc.title ?? null),
        siteUrl: resolveUrl(doc.home_page_url, base),
        items,
    };
}

// ---------- entry point ----------

function looksLikeHtml(body: string): boolean {
    const head = body.slice(0, 4000).toLowerCase();
    return (
        head.includes('<!doctype html') ||
        head.includes('<html') ||
        (head.includes('<head') && head.includes('<body')) ||
        /<link[^>]+rel=["']?alternate/.test(head)
    );
}

/** Detects the feed format and normalises it. */
export function parseFeed(body: string, feedUrl: string): FeedParseResult {
    const text = body.replace(/^\uFEFF/, '').trim();
    if (!text) return { ok: false, reason: 'empty', error: 'Empty response body' };
    if (text.startsWith('{')) return parseJsonFeed(text, feedUrl);
    if (!text.startsWith('<')) return { ok: false, reason: 'invalid', error: 'Response is neither XML nor JSON' };

    let doc: XmlNode;
    try {
        doc = parser.parse(text) as XmlNode;
    } catch (err) {
        return {
            ok: false,
            reason: looksLikeHtml(text) ? 'html' : 'invalid',
            error: `XML parse error: ${(err as Error).message.slice(0, 200)}`,
        };
    }
    if (isObject(doc.rss)) return parseRss(doc, feedUrl);
    if (isObject(doc.feed)) return parseAtom(doc, feedUrl);
    if (isObject(doc['rdf:RDF'])) return parseRdf(doc, feedUrl);
    if (isObject(doc.RDF)) return parseRdf({ 'rdf:RDF': doc.RDF }, feedUrl);
    if (looksLikeHtml(text) || isObject(doc.html))
        return { ok: false, reason: 'html', error: 'Response is an HTML page, not a feed' };
    const root = Object.keys(doc).find((k) => !k.startsWith('?')) ?? 'unknown';
    return { ok: false, reason: 'invalid', error: `Not a recognised feed format (root element <${root}>)` };
}

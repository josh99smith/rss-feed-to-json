import { setTimeout as sleep } from 'node:timers/promises';

import { Actor, log } from 'apify';

import { type FeedItem, type FeedType, type ParsedFeed, parseFeed } from './feed.js';
import { createFetcher, type ErrorType, type Fetcher } from './fetch.js';
import { COMMON_FEED_PATHS, discoverFeedLinks, htmlToText, truncate } from './html.js';

const CHARGE_EVENT = 'feed-item';
const PUSH_BATCH_SIZE = 500;
const FEED_CONCURRENCY = 10;
const MAX_CONTENT_HTML = 50_000;
const MAX_CONTENT_TEXT = 5_000;

interface Input {
    feedUrls?: (string | { url: string })[];
    maxItemsPerFeed?: number;
    publishedAfter?: string;
    includeContent?: boolean;
    plainText?: boolean;
    timeoutSecs?: number;
    proxyConfiguration?: {
        useApifyProxy?: boolean;
        apifyProxyGroups?: string[];
        apifyProxyCountry?: string;
        proxyUrls?: string[];
    };
}

interface ItemRecord {
    feedUrl: string;
    feedTitle: string | null;
    feedType: FeedType;
    id: string | null;
    title: string | null;
    url: string | null;
    author: string | null;
    publishedAt: string | null;
    updatedAt: string | null;
    summary: string | null;
    contentHtml: string | null;
    contentText: string | null;
    categories: string[];
    enclosures: { url: string; type: string | null; length: number | null }[];
    imageUrl: string | null;
    fetchedAt: string;
    /** Present only when the feed was discovered from a web page. */
    discoveredFrom?: string;
}

interface FailureRecord {
    feedUrl: string;
    success: false;
    errorType: ErrorType;
    error: string;
    statusCode?: number;
    fetchedAt: string;
}

function normalizeInputUrl(raw: string): string | null {
    let value = raw.trim();
    if (!value) return null;
    if (/^feed:\/\//i.test(value)) value = value.replace(/^feed:\/\//i, 'https://');
    if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
    try {
        const parsed = new URL(value);
        if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost') return null;
        return parsed.toString();
    } catch {
        return null;
    }
}

type LoadResult =
    | { ok: true; feed: ParsedFeed; feedUrl: string; discoveredFrom?: string }
    | { ok: false; failure: Omit<FailureRecord, 'fetchedAt'> };

/** Fetches a URL and parses it as a feed; if it is a web page, discovers and loads the first advertised feed. */
async function loadFeed(inputUrl: string, fetch: Fetcher): Promise<LoadResult> {
    const response = await fetch(inputUrl);
    if (!response.ok) {
        return {
            ok: false,
            failure: {
                feedUrl: inputUrl,
                success: false,
                errorType: response.errorType,
                error: response.error,
                statusCode: response.statusCode,
            },
        };
    }
    const parsed = parseFeed(response.body, response.finalUrl);
    if (parsed.ok) return { ok: true, feed: parsed, feedUrl: inputUrl };
    if (parsed.reason !== 'html') {
        return {
            ok: false,
            failure: {
                feedUrl: inputUrl,
                success: false,
                errorType: 'invalid-feed',
                error: parsed.error,
                statusCode: response.statusCode,
            },
        };
    }

    // The URL is an ordinary web page: look for advertised feeds, then common paths.
    const advertised = discoverFeedLinks(response.body, response.finalUrl);
    const { origin } = new URL(response.finalUrl);
    const candidates = [
        ...advertised,
        ...(advertised.length ? [] : COMMON_FEED_PATHS.map((p) => `${origin}${p}`)),
    ].filter((u) => u !== inputUrl);
    log.debug(`${inputUrl}: not a feed, trying ${candidates.length} candidate feed URL(s)`);
    let lastError = 'No feed link found on the page';
    for (const candidate of candidates.slice(0, 12)) {
        const res = await fetch(candidate);
        if (!res.ok) {
            lastError = `${candidate}: ${res.error}`;
            continue;
        }
        const feed = parseFeed(res.body, res.finalUrl);
        if (feed.ok) return { ok: true, feed, feedUrl: candidate, discoveredFrom: inputUrl };
        lastError = `${candidate}: ${feed.error}`;
    }
    return {
        ok: false,
        failure: {
            feedUrl: inputUrl,
            success: false,
            errorType: 'not-found',
            error: advertised.length
                ? `Page advertises ${advertised.length} feed link(s) but none could be parsed (${lastError})`
                : `No RSS, Atom or JSON feed found for this page (${lastError})`,
        },
    };
}

await Actor.init();

Actor.on('aborting', async () => {
    await sleep(1000);
    await Actor.exit();
});

const input = (await Actor.getInput<Input>()) ?? {};
const maxItemsPerFeed = Math.min(Math.max(input.maxItemsPerFeed ?? 100, 1), 10_000);
const includeContent = input.includeContent ?? true;
const plainText = input.plainText ?? true;
const timeoutSecs = Math.min(Math.max(input.timeoutSecs ?? 30, 5), 120);

let publishedAfterMs: number | null = null;
if (input.publishedAfter?.trim()) {
    publishedAfterMs = Date.parse(input.publishedAfter.trim());
    if (Number.isNaN(publishedAfterMs)) {
        await Actor.fail(
            `Input "publishedAfter" is not a valid date: "${input.publishedAfter}". Use ISO 8601, e.g. 2026-01-31 or 2026-01-31T00:00:00Z.`,
        );
    }
}

const rawUrls = (input.feedUrls ?? []).map((u) => (typeof u === 'string' ? u : (u?.url ?? '')));
if (rawUrls.length === 0) {
    await Actor.fail(
        'Input "feedUrls" is empty. Provide at least one feed or website URL, e.g. ["https://blog.apify.com/rss/"].',
    );
}

const seen = new Set<string>();
const targets: string[] = [];
const invalid: FailureRecord[] = [];
for (const raw of rawUrls) {
    const normalized = normalizeInputUrl(raw);
    if (!normalized) {
        invalid.push({
            feedUrl: raw,
            success: false,
            errorType: 'invalid-url',
            error: 'Not a valid feed or website URL',
            fetchedAt: new Date().toISOString(),
        });
        continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    targets.push(normalized);
}
if (invalid.length) await Actor.pushData(invalid); // free: nothing was delivered

const proxyConfiguration =
    input.proxyConfiguration?.useApifyProxy || input.proxyConfiguration?.proxyUrls?.length
        ? await Actor.createProxyConfiguration(input.proxyConfiguration)
        : undefined;
const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;
const fetch = createFetcher({ timeoutMs: timeoutSecs * 1000, proxyUrl, retries: 1 });
const { isPayPerEvent } = Actor.getChargingManager().getPricingInfo();

let feedsParsed = 0;
let itemsPushed = 0;
let itemsCharged = 0;
let itemsSkippedByDate = 0;
let failures = invalid.length;
let stopBecauseOfBudget = false;

log.info(
    `Fetching ${targets.length} feed(s): up to ${maxItemsPerFeed} items each${publishedAfterMs ? `, published after ${new Date(publishedAfterMs).toISOString()}` : ''}.`,
);

function shapeItem(
    item: FeedItem,
    feed: ParsedFeed,
    feedUrl: string,
    discoveredFrom: string | undefined,
    fetchedAt: string,
): ItemRecord {
    const contentHtml = truncate(item.contentHtml, MAX_CONTENT_HTML);
    const record: ItemRecord = {
        feedUrl,
        feedTitle: feed.feedTitle,
        feedType: feed.feedType,
        id: item.id,
        title: item.title,
        url: item.url,
        author: item.author,
        publishedAt: item.publishedAt,
        updatedAt: item.updatedAt,
        summary: truncate(item.summary, MAX_CONTENT_TEXT),
        contentHtml: includeContent ? contentHtml : null,
        contentText: plainText ? htmlToText(item.contentHtml ?? item.summary, MAX_CONTENT_TEXT) : null,
        categories: item.categories,
        enclosures: item.enclosures,
        imageUrl: item.imageUrl,
        fetchedAt,
    };
    if (discoveredFrom) record.discoveredFrom = discoveredFrom;
    return record;
}

/** Pushes charged records in batches; returns false once the run's charge limit is reached. */
async function pushCharged(records: ItemRecord[]): Promise<boolean> {
    for (let i = 0; i < records.length; i += PUSH_BATCH_SIZE) {
        if (stopBecauseOfBudget) return false;
        const batch = records.slice(i, i + PUSH_BATCH_SIZE);
        const { chargedCount, eventChargeLimitReached } = await Actor.pushData(batch, CHARGE_EVENT);
        // In pay-per-event mode the SDK only stores as many items as the budget allows.
        const stored = isPayPerEvent ? Math.min(chargedCount ?? 0, batch.length) : batch.length;
        itemsPushed += stored;
        itemsCharged += isPayPerEvent ? (chargedCount ?? 0) : stored;
        if (eventChargeLimitReached) {
            stopBecauseOfBudget = true;
            log.warning(
                'Maximum charge limit for this run reached; stopping early. Raise the run cost limit to fetch more items.',
            );
            return false;
        }
    }
    return true;
}

async function processFeed(target: string): Promise<void> {
    if (stopBecauseOfBudget) return;
    const loaded = await loadFeed(target, fetch);
    const fetchedAt = new Date().toISOString();
    if (!loaded.ok) {
        failures += 1;
        log.warning(`${target}: ${loaded.failure.errorType} - ${loaded.failure.error}`);
        await Actor.pushData({ ...loaded.failure, fetchedAt }); // free of charge
        return;
    }
    feedsParsed += 1;
    const { feed, feedUrl, discoveredFrom } = loaded;

    const seenItems = new Set<string>();
    const records: ItemRecord[] = [];
    let skippedByDate = 0;
    for (const item of feed.items) {
        if (records.length >= maxItemsPerFeed) break;
        if (publishedAfterMs !== null && item.publishedAt && Date.parse(item.publishedAt) < publishedAfterMs) {
            skippedByDate += 1;
            continue;
        }
        const key = item.id ?? item.url ?? item.title;
        if (key) {
            if (seenItems.has(key)) continue;
            seenItems.add(key);
        }
        // Silent-failure guard: an item with neither title, link nor content is not a deliverable result.
        if (!item.title && !item.url && !item.contentHtml) continue;
        records.push(shapeItem(item, feed, feedUrl, discoveredFrom, fetchedAt));
    }
    itemsSkippedByDate += skippedByDate;

    const label = feed.feedTitle ? `"${feed.feedTitle}"` : feedUrl;
    log.info(
        `${feedUrl}: ${feed.feedType} feed ${label} with ${feed.items.length} item(s), delivering ${records.length}${skippedByDate ? ` (${skippedByDate} older than publishedAfter)` : ''}${discoveredFrom ? ` (discovered from ${discoveredFrom})` : ''}`,
    );
    if (records.length === 0) return;
    await pushCharged(records);
}

const pending = [...targets];
const workers = Array.from({ length: Math.min(FEED_CONCURRENCY, pending.length) }, async () => {
    while (pending.length > 0 && !stopBecauseOfBudget) {
        const next = pending.shift();
        if (!next) break;
        try {
            await processFeed(next);
        } catch (err) {
            failures += 1;
            const message = err instanceof Error ? err.message : String(err);
            log.exception(err as Error, `${next}: unexpected error`);
            await Actor.pushData({
                feedUrl: next,
                success: false,
                errorType: 'other',
                error: message.slice(0, 500),
                fetchedAt: new Date().toISOString(),
            } satisfies FailureRecord);
        }
    }
});
await Promise.all(workers);

const summary = {
    feedsRequested: rawUrls.length,
    feedsParsed,
    itemsDelivered: itemsPushed,
    itemsCharged: isPayPerEvent ? itemsCharged : itemsPushed,
    itemsSkippedByDate,
    failures,
    stoppedEarlyDueToBudget: stopBecauseOfBudget,
};
await Actor.setValue('SUMMARY', summary);
log.info(`Done. ${JSON.stringify(summary)}`);

await Actor.exit();

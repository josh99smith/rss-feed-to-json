import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { normalizeDate, parseFeed, rawToHtml } from '../src/feed.js';
import { categorizeError, decodeBody } from '../src/fetch.js';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:media="http://search.yahoo.com/mrss/" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title><![CDATA[Example & Co News]]></title>
  <link>https://example.com/</link>
  <itunes:author>Feed Author</itunes:author>
  <item>
    <title>First &lt;em&gt;post&lt;/em&gt; &#8211; hooray</title>
    <link>/posts/1</link>
    <guid isPermaLink="false">post-1</guid>
    <dc:creator><![CDATA[Jane Doe]]></dc:creator>
    <pubDate>Tue, 10 Jun 2003 04:00:00 GMT</pubDate>
    <atom:updated>2003-06-11T00:00:00Z</atom:updated>
    <description><![CDATA[<p>Short &amp; sweet <b>summary</b></p>]]></description>
    <content:encoded>&lt;p&gt;Full &lt;i&gt;content&lt;/i&gt; with &amp;amp; entity&lt;/p&gt;&lt;img src="https://cdn.example.com/hero.jpg" /&gt;</content:encoded>
    <category>Tech</category>
    <category domain="https://example.com/cats">tech</category>
    <category><![CDATA[Opinion]]></category>
    <enclosure url="https://cdn.example.com/episode.mp3" type="audio/mpeg" length="12345"/>
    <enclosure url="https://cdn.example.com/episode.mp3" type="audio/mpeg" length="12345"/>
    <media:content url="https://cdn.example.com/media.jpg" medium="image" fileSize="99"/>
  </item>
  <item>
    <title>Second</title>
    <guid isPermaLink="true">https://example.com/posts/2</guid>
    <author>bob@example.com (Bob Smith)</author>
    <pubDate>Wed, 11 Jun 2003 09:30:00 PDT</pubDate>
    <description>Plain text description with &lt;b&gt;escaped&lt;/b&gt; html</description>
    <itunes:image href="https://cdn.example.com/cover.png"/>
  </item>
  <item>
    <title>Third: no date, no link</title>
    <description></description>
  </item>
</channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <title type="html">Atom &amp;lt;b&amp;gt;Feed&amp;lt;/b&amp;gt;</title>
  <link rel="self" href="https://example.com/atom.xml"/>
  <link rel="alternate" type="text/html" href="https://example.com/"/>
  <author><name>Site Author</name></author>
  <entry>
    <id>urn:uuid:1</id>
    <title>Entry one</title>
    <link rel="alternate" type="text/html" href="/entries/1"/>
    <link rel="enclosure" type="application/pdf" href="https://example.com/files/1.pdf" length="4096"/>
    <published>2024-02-03T04:05:06+01:00</published>
    <updated>2024-02-04T00:00:00Z</updated>
    <author><name>Entry Author</name><email>a@example.com</email></author>
    <category term="atom" label="Atom Syndication"/>
    <category term="xml"/>
    <summary type="html">&lt;p&gt;Summary &amp;amp; more&lt;/p&gt;</summary>
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Real <strong>XHTML</strong> content</p><img src="https://example.com/x.png"/></div></content>
    <media:thumbnail url="https://example.com/thumb.png"/>
  </entry>
  <entry>
    <id>urn:uuid:2</id>
    <title>Entry two</title>
    <link>https://example.com/entries/2</link>
    <updated>2024-01-01T00:00:00Z</updated>
    <content type="text">Plain &lt;text&gt; content</content>
  </entry>
</feed>`;

const RDF = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel rdf:about="https://example.com/rss1"><title>RSS 1.0 Channel</title><link>https://example.com/</link></channel>
  <item rdf:about="https://example.com/rdf/1">
    <title>RDF item</title>
    <link>https://example.com/rdf/1</link>
    <dc:creator>Alice</dc:creator>
    <dc:date>2005-05-05T05:05:05Z</dc:date>
    <dc:subject>Science</dc:subject>
    <description>An RDF description</description>
    <content:encoded><![CDATA[<p>RDF <b>content</b></p>]]></content:encoded>
  </item>
</rdf:RDF>`;

const JSON_FEED = JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'JSON Feed Example',
    home_page_url: 'https://example.com/',
    authors: [{ name: 'Feed Person' }],
    items: [
        {
            id: 1,
            url: 'https://example.com/json/1',
            title: 'JSON item',
            content_html: '<p>Hello <b>JSON</b></p>',
            summary: 'A summary',
            image: 'https://example.com/img.png',
            date_published: '2024-03-04T05:06:07Z',
            date_modified: '2024-03-05T00:00:00Z',
            tags: ['json', 'feed', 'json'],
            attachments: [{ url: 'https://example.com/a.mp3', mime_type: 'audio/mpeg', size_in_bytes: 777 }],
        },
        { id: 'two', content_text: 'Line 1\nLine 2 <not html>', authors: [{ name: 'Item Person' }] },
    ],
});

describe('parseFeed: RSS 2.0', () => {
    const feed = parseFeed(RSS, 'https://example.com/feed.xml');
    if (!feed.ok) throw new Error(feed.error);

    it('reads channel metadata', () => {
        expect(feed.feedType).toBe('rss');
        expect(feed.feedTitle).toBe('Example & Co News');
        expect(feed.siteUrl).toBe('https://example.com/');
        expect(feed.items).toHaveLength(3);
    });

    it('normalises the first item: entities, CDATA, content:encoded, categories, enclosures', () => {
        const item = feed.items[0];
        expect(item.id).toBe('post-1');
        expect(item.title).toBe('First post \u2013 hooray');
        expect(item.url).toBe('https://example.com/posts/1');
        expect(item.author).toBe('Jane Doe');
        expect(item.publishedAt).toBe('2003-06-10T04:00:00.000Z');
        expect(item.updatedAt).toBe('2003-06-11T00:00:00.000Z');
        expect(item.summary).toBe('Short & sweet summary');
        expect(item.contentHtml).toBe(
            '<p>Full <i>content</i> with &amp; entity</p><img src="https://cdn.example.com/hero.jpg" />',
        );
        expect(item.categories).toEqual(['Tech', 'Opinion']);
        expect(item.enclosures).toEqual([
            { url: 'https://cdn.example.com/episode.mp3', type: 'audio/mpeg', length: 12345 },
            { url: 'https://cdn.example.com/media.jpg', type: null, length: 99 },
        ]);
        expect(item.imageUrl).toBe('https://cdn.example.com/media.jpg');
    });

    it('uses permalink guids, RSS author names, timezone abbreviations and itunes images', () => {
        const item = feed.items[1];
        expect(item.id).toBe('https://example.com/posts/2');
        expect(item.url).toBe('https://example.com/posts/2');
        expect(item.author).toBe('Bob Smith');
        expect(item.publishedAt).toBe('2003-06-11T16:30:00.000Z');
        expect(item.summary).toBe('Plain text description with escaped html');
        expect(item.contentHtml).toBe('Plain text description with <b>escaped</b> html');
        expect(item.imageUrl).toBe('https://cdn.example.com/cover.png');
    });

    it('falls back to the feed author and leaves missing fields null', () => {
        const item = feed.items[2];
        expect(item.id).toBeNull();
        expect(item.url).toBeNull();
        expect(item.author).toBe('Feed Author');
        expect(item.publishedAt).toBeNull();
        expect(item.summary).toBeNull();
        expect(item.contentHtml).toBeNull();
        expect(item.enclosures).toEqual([]);
    });
});

describe('parseFeed: Atom', () => {
    const feed = parseFeed(ATOM, 'https://example.com/atom.xml');
    if (!feed.ok) throw new Error(feed.error);

    it('reads feed metadata and strips HTML from titles', () => {
        expect(feed.feedType).toBe('atom');
        expect(feed.feedTitle).toBe('Atom Feed');
        expect(feed.siteUrl).toBe('https://example.com/');
    });

    it('normalises an entry with xhtml content, enclosure link and categories', () => {
        const item = feed.items[0];
        expect(item.id).toBe('urn:uuid:1');
        expect(item.url).toBe('https://example.com/entries/1');
        expect(item.author).toBe('Entry Author');
        expect(item.publishedAt).toBe('2024-02-03T03:05:06.000Z');
        expect(item.updatedAt).toBe('2024-02-04T00:00:00.000Z');
        expect(item.summary).toBe('Summary & more');
        expect(item.contentHtml).toContain('<p>Real <strong>XHTML</strong> content</p>');
        expect(item.categories).toEqual(['Atom Syndication', 'xml']);
        expect(item.enclosures).toEqual([
            { url: 'https://example.com/files/1.pdf', type: 'application/pdf', length: 4096 },
        ]);
        expect(item.imageUrl).toBe('https://example.com/thumb.png');
    });

    it('handles text content, bare <link> elements and feed-level author fallback', () => {
        const item = feed.items[1];
        expect(item.url).toBe('https://example.com/entries/2');
        expect(item.author).toBe('Site Author');
        expect(item.publishedAt).toBe('2024-01-01T00:00:00.000Z'); // falls back to <updated>
        expect(item.contentHtml).toBe('Plain &lt;text&gt; content');
    });
});

describe('parseFeed: RSS 1.0 and JSON Feed', () => {
    it('parses RDF feeds', () => {
        const feed = parseFeed(RDF, 'https://example.com/rss1');
        if (!feed.ok) throw new Error(feed.error);
        expect(feed.feedType).toBe('rss1');
        expect(feed.feedTitle).toBe('RSS 1.0 Channel');
        const item = feed.items[0];
        expect(item.id).toBe('https://example.com/rdf/1');
        expect(item.author).toBe('Alice');
        expect(item.publishedAt).toBe('2005-05-05T05:05:05.000Z');
        expect(item.categories).toEqual(['Science']);
        expect(item.summary).toBe('An RDF description');
        expect(item.contentHtml).toBe('<p>RDF <b>content</b></p>');
    });

    it('parses JSON Feed 1.1', () => {
        const feed = parseFeed(JSON_FEED, 'https://example.com/feed.json');
        if (!feed.ok) throw new Error(feed.error);
        expect(feed.feedType).toBe('json');
        expect(feed.feedTitle).toBe('JSON Feed Example');
        const [one, two] = feed.items;
        expect(one.id).toBe('1');
        expect(one.title).toBe('JSON item');
        expect(one.author).toBe('Feed Person');
        expect(one.publishedAt).toBe('2024-03-04T05:06:07.000Z');
        expect(one.updatedAt).toBe('2024-03-05T00:00:00.000Z');
        expect(one.categories).toEqual(['json', 'feed']);
        expect(one.enclosures).toEqual([{ url: 'https://example.com/a.mp3', type: 'audio/mpeg', length: 777 }]);
        expect(one.imageUrl).toBe('https://example.com/img.png');
        expect(two.id).toBe('two');
        expect(two.author).toBe('Item Person');
        expect(two.contentHtml).toBe('Line 1<br>Line 2 &lt;not html&gt;');
    });
});

describe('parseFeed: rejects non-feeds with the right reason', () => {
    it('flags HTML pages for discovery', () => {
        const html = parseFeed(
            '<!DOCTYPE html><html><head><link rel="alternate" type="application/rss+xml" href="/feed"></head><body>x</body></html>',
            'https://a.com/',
        );
        expect(html).toMatchObject({ ok: false, reason: 'html' });
    });

    it('flags other XML, invalid JSON, junk and empty bodies as invalid', () => {
        expect(parseFeed('<urlset><url><loc>https://a.com</loc></url></urlset>', 'https://a.com/')).toMatchObject({
            ok: false,
            reason: 'invalid',
        });
        expect(parseFeed('{"not": "a feed"}', 'https://a.com/')).toMatchObject({ ok: false, reason: 'invalid' });
        expect(parseFeed('{oops', 'https://a.com/')).toMatchObject({ ok: false, reason: 'invalid' });
        expect(parseFeed('Just some text', 'https://a.com/')).toMatchObject({ ok: false, reason: 'invalid' });
        expect(parseFeed('   ', 'https://a.com/')).toMatchObject({ ok: false, reason: 'empty' });
    });

    it('tolerates a BOM, leading whitespace and a feed without items', () => {
        const feed = parseFeed(
            '\uFEFF  <rss version="2.0"><channel><title>Empty</title></channel></rss>',
            'https://a.com/',
        );
        expect(feed).toMatchObject({ ok: true, feedType: 'rss', feedTitle: 'Empty', items: [] });
    });
});

describe('helpers', () => {
    it('rawToHtml keeps CDATA verbatim and decodes escaped markup', () => {
        expect(rawToHtml('<![CDATA[<p>a &amp; b</p>]]>')).toBe('<p>a &amp; b</p>');
        expect(rawToHtml('&lt;p&gt;a &amp;amp; b&lt;/p&gt;')).toBe('<p>a &amp; b</p>');
        expect(rawToHtml('x <![CDATA[<b>y</b>]]> &amp; z')).toBe('x <b>y</b> & z');
        expect(rawToHtml('   ')).toBeNull();
    });

    it('normalizeDate handles RFC 822, ISO 8601 and odd zones', () => {
        expect(normalizeDate('Mon, 01 Jan 2024 10:00:00 +0200')).toBe('2024-01-01T08:00:00.000Z');
        expect(normalizeDate('2024-01-01')).toBe('2024-01-01T00:00:00.000Z');
        expect(normalizeDate('Mon, 01 Jan 2024 10:00:00 EST')).toBe('2024-01-01T15:00:00.000Z');
        expect(normalizeDate('Mon, 01 Jan 2024 10:00:00 UT')).toBe('2024-01-01T10:00:00.000Z');
        expect(normalizeDate('not a date')).toBeNull();
        expect(normalizeDate(undefined)).toBeNull();
    });

    it('categorises errors and gunzips raw bodies', () => {
        expect(categorizeError('HTTP 403', 403)).toBe('blocked');
        expect(categorizeError('HTTP 404', 404)).toBe('not-found');
        expect(categorizeError('HTTP 502', 502)).toBe('http-error');
        expect(categorizeError('getaddrinfo ENOTFOUND')).toBe('dns');
        expect(categorizeError('Timeout awaiting request')).toBe('timeout');
        expect(categorizeError('read ECONNRESET')).toBe('network');
        const xml = '<rss><channel><title>gz</title></channel></rss>';
        expect(decodeBody(gzipSync(Buffer.from(xml)))).toBe(xml);
        expect(decodeBody(Buffer.from(xml))).toBe(xml);
    });
});

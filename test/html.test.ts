import { describe, expect, it } from 'vitest';

import { discoverFeedLinks, htmlToText, stripTags, truncate } from '../src/html.js';

describe('htmlToText', () => {
    it('keeps paragraph breaks, decodes entities and drops scripts', () => {
        const html =
            '<h1>Title</h1><p>First &amp; <b>bold</b>.</p><script>alert(1)</script><p>Second<br>line</p><ul><li>a</li><li>b</li></ul>';
        expect(htmlToText(html)).toBe('Title\nFirst & bold.\nSecond\nline\na\nb');
    });

    it('collapses whitespace and non-breaking spaces', () => {
        expect(htmlToText('<p>  a \u00a0  b  </p>\n\n\n\n<p>c</p>')).toBe('a b\n\nc');
    });

    it('caps the output and returns null for empty input', () => {
        expect(htmlToText('<p>' + 'x'.repeat(100) + '</p>', 10)).toBe('xxxxxxxxxx');
        expect(htmlToText('<p></p>')).toBeNull();
        expect(htmlToText(null)).toBeNull();
    });

    it('stripTags and truncate are simple utilities', () => {
        expect(stripTags('<b>a</b> <i>b</i>')).toBe('a b');
        expect(truncate('abcdef', 3)).toBe('abc');
        expect(truncate(null, 3)).toBeNull();
    });
});

describe('discoverFeedLinks', () => {
    const page = `<!DOCTYPE html><html><head>
        <link rel="stylesheet" href="/style.css">
        <link rel="alternate" type="application/rss+xml" title="RSS" href="/feed/">
        <link rel="alternate" type="application/atom+xml; charset=utf-8" href="https://cdn.example.com/atom.xml">
        <link rel="alternate" type="application/feed+json" href="feed.json">
        <link rel="alternate" type="application/rss+xml" href="/feed/">
        <link rel="alternate" hreflang="de" href="https://example.com/de/">
        <link rel="feed" href="/other-feed">
        <link rel="alternate" type="application/rss+xml" href="mailto:nope">
    </head><body></body></html>`;

    it('returns absolute feed URLs in document order without duplicates', () => {
        expect(discoverFeedLinks(page, 'https://example.com/blog/post')).toEqual([
            'https://example.com/feed/',
            'https://cdn.example.com/atom.xml',
            'https://example.com/blog/feed.json',
            'https://example.com/other-feed',
        ]);
    });

    it('returns an empty list when the page advertises no feeds', () => {
        expect(discoverFeedLinks('<html><head><title>x</title></head></html>', 'https://example.com/')).toEqual([]);
    });
});

# Changelog

## 0.2.0 (2026-09-19)

- Monitor mode: `onlyNew` remembers delivered item ids (guid, link or a title + date hash) in a named key-value store (`stateStoreName`, default `rss-feed-to-json-seen`) and later runs return only items not seen before. Skipped items are never billed.
- Every item record now carries `isNew`; `SUMMARY` reports `newItems`, `alreadySeen` and `stateStoreName`.
- `seenTtlDays` (default 90) prunes stale ids; the store is capped at 100,000 ids.

## 0.1.0 (2026-09-18)

- Initial release: parses RSS 2.0, Atom 1.0, RSS 1.0 (RDF) and JSON Feed 1.x into one normalized item shape.
- Auto-discovers feeds advertised by ordinary web pages (`<link rel="alternate">`) and common feed paths.
- Handles gzip, redirects, CDATA, escaped HTML, `content:encoded`, `dc:creator`, categories, media and podcast enclosures, plain-text extraction and date normalization to ISO 8601.
- Feeds that cannot be found, fetched or parsed are reported in the dataset and never billed.

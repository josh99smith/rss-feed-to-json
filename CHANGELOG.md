# Changelog

## 0.2.2 (2026-09-23)

- Listing: joined the Best Damn series. New title "Best Damn RSS to JSON Converter", new description, icon and README banner. No change to inputs, output or pricing.

## 0.2.1 (2026-09-20)

- Fixed: with several feeds fetched in parallel, two batches could be delivered at once and overshoot the run's cost cap with items that were never billed. Charged pushes are now serialised and the remaining budget is also tracked from the Actor's own charge count.
- Duplicate input URLs are now deduplicated by the Actor instead of being rejected by input validation.

## 0.2.0 (2026-09-19)

- Monitor mode: `onlyNew` remembers delivered item ids (guid, link or a title + date hash) in a named key-value store (`stateStoreName`, default `rss-feed-to-json-seen`) and later runs return only items not seen before. Skipped items are never billed.
- Every item record now carries `isNew`; `SUMMARY` reports `newItems`, `alreadySeen` and `stateStoreName`.
- `seenTtlDays` (default 90) prunes stale ids; the store is capped at 100,000 ids.

## 0.1.0 (2026-09-18)

- Initial release: parses RSS 2.0, Atom 1.0, RSS 1.0 (RDF) and JSON Feed 1.x into one normalized item shape.
- Auto-discovers feeds advertised by ordinary web pages (`<link rel="alternate">`) and common feed paths.
- Handles gzip, redirects, CDATA, escaped HTML, `content:encoded`, `dc:creator`, categories, media and podcast enclosures, plain-text extraction and date normalization to ISO 8601.
- Feeds that cannot be found, fetched or parsed are reported in the dataset and never billed.

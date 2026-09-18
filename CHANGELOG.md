# Changelog

## 0.1.0 (2026-09-18)

- Initial release: parses RSS 2.0, Atom 1.0, RSS 1.0 (RDF) and JSON Feed 1.x into one normalized item shape.
- Auto-discovers feeds advertised by ordinary web pages (`<link rel="alternate">`) and common feed paths.
- Handles gzip, redirects, CDATA, escaped HTML, `content:encoded`, `dc:creator`, categories, media and podcast enclosures, plain-text extraction and date normalization to ISO 8601.
- Feeds that cannot be found, fetched or parsed are reported in the dataset and never billed.

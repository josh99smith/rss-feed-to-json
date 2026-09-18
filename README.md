**RSS to JSON** converter and RSS feed parser API: turn any RSS, Atom or JSON feed into clean, consistent JSON. Paste feed URLs (or just website URLs, and the Actor finds the feed for you) and get back one normalized record per article, episode or post: title, link, author, publication date, categories, HTML and plain-text content, lead image and media enclosures, whichever feed format the publisher uses.

It is built for **developers, content teams, newsletter builders and automation users** who do not want to write another XML parser or pay a monthly subscription for a feed-to-JSON service. You pay a small flat price per item, and feeds that cannot be found, fetched or parsed are reported **free of charge**.

## Features

- Convert an RSS or Atom feed to JSON with one API call
- Parse RSS 2.0, Atom 1.0, RSS 1.0 (RDF) and JSON Feed into the same item shape
- Find the RSS feed of a website automatically from its URL
- Get full article HTML and plain text from a feed for LLM and RAG pipelines
- Extract podcast enclosures, media files and lead images from feeds
- Fetch only new feed items published after a given date
- Aggregate many RSS feeds into one dataset for newsletters and monitoring

## What can you do with RSS and Atom Feed to JSON?

- **Content aggregation**: merge dozens of blogs, news sites and podcasts into one dataset for a newsletter, a news app or an internal digest.
- **Monitor competitors and industry news**: schedule hourly runs, filter with **Published after** and push new items to Slack, email, Google Sheets or a webhook.
- **Feed AI and RAG pipelines**: the `contentText` field gives you clean article text ready for embeddings, summarisation or classification without scraping every page.
- **Replace Zapier / Make RSS triggers**: run on a schedule for a fraction of the price and keep the full item history in a dataset you own.
- **Podcast and media tooling**: enclosure URLs, MIME types and file sizes are extracted from RSS enclosures, Media RSS and JSON Feed attachments.
- **SEO and content research**: track publishing frequency, authors and categories across many sites.

## How it works

Each URL is downloaded (with gzip and redirects handled) and detected as RSS 2.0, Atom 1.0, RSS 1.0 (RDF) or JSON Feed 1.x. If the URL is an ordinary web page, the Actor reads the `<link rel="alternate" type="application/rss+xml">` / `atom+xml` / `feed+json` tags in the page head and, failing that, probes common paths such as `/feed`, `/rss.xml` and `/atom.xml`, then parses the first working feed. CDATA blocks, escaped HTML, HTML entities, `content:encoded`, `dc:creator`, categories, `media:content`, `itunes:image` and enclosures are all normalized into one item shape, and dates are converted to ISO 8601.

The Actor reads feeds only: it does not open the linked articles, so the content is whatever the publisher puts in the feed (full text for most blogs, a summary for many news sites).

## How to use it

1. Open the Actor and paste your feed or website URLs into **Feed or website URLs**, one per line.
2. Optionally set **Max items per feed**, a **Published after** date, and switch off **Include full HTML content** if you only need titles and links.
3. Click **Start**. Items appear in the **Output** tab within seconds.
4. Download the dataset as JSON, CSV, Excel or XML, or connect it to Google Sheets, Slack, Make, Zapier or a webhook via the **Integrations** tab.

```json
{
    "feedUrls": ["https://blog.apify.com/rss/", "https://hnrss.org/frontpage", "https://www.theverge.com"],
    "maxItemsPerFeed": 100,
    "publishedAfter": "2026-01-01",
    "includeContent": true,
    "plainText": true
}
```

## Output

One record per feed item (trimmed):

```json
{
    "feedUrl": "https://blog.apify.com/rss/",
    "feedTitle": "Apify Blog",
    "feedType": "rss",
    "id": "64884d212b8e8a0001df7576",
    "title": "12 LangChain alternatives for building AI agents in 2026",
    "url": "https://blog.apify.com/langchain-alternatives/",
    "author": "Theo Vasilis",
    "publishedAt": "2026-09-15T12:00:00.000Z",
    "updatedAt": null,
    "summary": "LangChain is a powerful framework for developing LLM apps, but it's not without its disadvantages. So what are the alternatives?",
    "contentHtml": "<img src=\"https://storage.ghost.io/.../langchain-alternatives-1.png\" alt=\"...\"><p>LangChain is still the most widely used framework ...</p>",
    "contentText": "LangChain is still the most widely used framework for building LLM applications ...",
    "categories": ["AI", "Tool comparisons"],
    "enclosures": [{ "url": "https://storage.ghost.io/.../langchain-alternatives-1.png", "type": null, "length": null }],
    "imageUrl": "https://storage.ghost.io/.../langchain-alternatives-1.png",
    "fetchedAt": "2026-09-18T19:55:04.974Z"
}
```

Feeds that could not be loaded are recorded too, so nothing silently disappears:

```json
{ "feedUrl": "https://example.com/no-feed-here", "success": false, "errorType": "not-found", "error": "No RSS, Atom or JSON feed found for this page", "fetchedAt": "..." }
```

## Output fields

| Field | Description |
| --- | --- |
| `feedUrl` | The feed that was parsed. When it was discovered from a web page, `discoveredFrom` holds the page URL. |
| `feedTitle` / `feedType` | Feed title and format: `rss`, `atom`, `rss1` or `json`. |
| `id` | Item identifier (`guid`, Atom `id`, JSON `id`), falling back to the link. |
| `title` / `url` / `author` | Item title (HTML stripped), absolute link and author name (`dc:creator`, `author`, Atom `author/name`, feed-level author as fallback). |
| `publishedAt` / `updatedAt` | ISO 8601 timestamps, or `null` when the feed has none. |
| `summary` | Plain-text summary (`description`, Atom `summary`, JSON `summary`), up to 5,000 characters. |
| `contentHtml` | Full HTML body (`content:encoded`, Atom `content`, JSON `content_html`), up to 50,000 characters. `null` when **Include full HTML content** is off. |
| `contentText` | The body as plain text with paragraph breaks, up to 5,000 characters. `null` when **Add plain-text content** is off. |
| `categories[]` | Categories, tags or `dc:subject` values, de-duplicated. |
| `enclosures[]` | `url`, `type` (MIME) and `length` (bytes) of enclosures, Media RSS content and JSON Feed attachments. |
| `imageUrl` | Lead image from Media RSS, `itunes:image`, an image enclosure or the first `<img>` in the content. |
| `errorType` | For failures only: `invalid-url`, `not-found`, `invalid-feed`, `http-error`, `blocked`, `dns`, `timeout`, `network` or `other`. |

## Use it from the API, Python, JavaScript or an AI agent

Run the Actor and get the dataset back in one HTTP call:

```bash
curl -X POST "https://api.apify.com/v2/acts/josh99smith~rss-feed-to-json/run-sync-get-dataset-items?token=<YOUR_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"feedUrls": ["https://blog.apify.com/rss/"], "maxItemsPerFeed": 20}'
```

Python, with the [apify-client](https://docs.apify.com/api/client/python) package:

```python
from apify_client import ApifyClient

client = ApifyClient("<YOUR_API_TOKEN>")
run = client.actor("josh99smith/rss-feed-to-json").call(
    run_input={"feedUrls": ["https://hnrss.org/frontpage"], "maxItemsPerFeed": 20, "publishedAfter": "2026-09-01"}
)
for item in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(item.get("publishedAt"), item.get("title"), item.get("url"))
```

JavaScript or TypeScript, with the [apify-client](https://docs.apify.com/api/client/js) package:

```javascript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: '<YOUR_API_TOKEN>' });
const run = await client.actor('josh99smith/rss-feed-to-json').call({
    feedUrls: ['https://blog.apify.com/rss/', 'https://www.theverge.com'],
    maxItemsPerFeed: 20,
    includeContent: false,
});
const { items } = await client.dataset(run.defaultDatasetId).listItems();
console.log(items.map((item) => [item.title, item.url]));
```

The Actor is also available as a tool through the Apify MCP server, so AI agents can call it directly, and it can be scheduled or connected to Zapier, Make, n8n and Google Sheets in the **Integrations** tab.

## Pricing: how much does it cost to convert a feed to JSON?

You pay a **flat price per delivered item** (shown next to the Start button); 2,000 items cost about $1. Nothing is charged for Actor start-up or for feeds that fail. Use **Max items per feed** and **Published after** to fetch only what you need, and the Actor stops automatically when it reaches the maximum cost you set for a run.

## Tips

- **Only new items**: on a schedule, set **Published after** to the previous run time (or pass it via the API) so you only pay for new articles.
- **Smaller datasets**: switch off **Include full HTML content** when you just need titles, links and dates; `contentText` remains available for search and LLM use.
- **Blocked feeds**: a few publishers block cloud IP addresses. Enable **Proxy configuration > Apify Proxy** in the Advanced section (proxy traffic is billed by Apify separately).
- **Websites instead of feeds**: pasting `https://www.theverge.com` is enough; the Actor picks up the advertised feed. If a site advertises several, the first working one is used, so paste the exact feed URL when you want a specific one.

## FAQ

### Which feed formats can be converted to JSON?

RSS 2.0 (including podcast feeds with iTunes and Media RSS extensions), Atom 1.0, RSS 1.0 / RDF and JSON Feed 1.0 and 1.1. Feeds served gzip-compressed or behind redirects work too.

### Why is `contentHtml` short or missing for some items?

The Actor returns exactly what the feed contains, and many news publishers only include a summary. To get full article text, pass the `url` values to a content-extraction Actor.

### How are feed dates handled?

RFC 822 (`Tue, 10 Jun 2003 04:00:00 GMT`), ISO 8601 and common timezone abbreviations are converted to UTC ISO 8601. Items whose dates cannot be parsed have `publishedAt: null` and are never filtered out by **Published after**.

### What are the limits on items, content size and feeds?

**Max items per feed** goes up to 10,000 per run (default 100). `contentHtml` is capped at 50,000 characters and `summary` and `contentText` at 5,000 characters each. A feed file may be up to 32 MB, up to 10 feeds are fetched in parallel, and each request times out after at most 120 seconds.

### Is it legal to parse RSS feeds?

Feeds are published for syndication and read exactly as a feed reader would, a couple of requests per feed. The Actor stores only what the publisher includes in the feed. You are responsible for using the content in line with the publisher's terms and the laws that apply to you.

## Related Actors by the same developer

- [Website Tech Stack Detector](https://apify.com/josh99smith/tech-stack-detector): find out what a website is built with.
- [Website Screenshot API](https://apify.com/josh99smith/website-screenshot-api): full-page screenshots and PDFs of any URL.
- [Google Autocomplete Keyword Scraper](https://apify.com/josh99smith/google-autocomplete-scraper): keyword suggestions from Google search.
- [App Store & Google Play Reviews Scraper](https://apify.com/josh99smith/app-reviews-scraper): app reviews from both stores.
- [PageSpeed Insights Core Web Vitals Audit](https://apify.com/josh99smith/pagespeed-insights-audit): Core Web Vitals via Google's API.
- [Remote Jobs Aggregator API](https://apify.com/josh99smith/remote-jobs-aggregator): remote job listings in one dataset.
- [PDF Text & Metadata Extractor](https://apify.com/josh99smith/pdf-text-extractor): text and metadata from PDF URLs.
- [Sitemap URL Extractor](https://apify.com/josh99smith/sitemap-url-extractor): all URLs from XML sitemaps.

## Support and feedback

Found a feed that is not parsed correctly? Open a ticket in the **Issues** tab of this Actor with the feed URL and we will fix it.

This Actor is open source under the MIT licence.

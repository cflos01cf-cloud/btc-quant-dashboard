import { XMLParser } from "fast-xml-parser";
import { NewsHeadline } from "./types";
import { classifyHeadlineHeuristic, classifyHeadlinesWithClaude } from "./sentiment";

const FEEDS = [
  { url: "https://www.coindesk.com/arc/outboundfeeds/rss/", source: "CoinDesk" },
  { url: "https://cointelegraph.com/rss/tag/bitcoin", source: "Cointelegraph" },
];

// Headlines don't change every 20 seconds, but without a cache the dashboard
// would re-fetch the RSS feed AND re-run sentiment classification (including
// the optional Claude API call) on every poll. With the browser tab open all
// day polling every 20s, that's ~4,300 calls/day for no benefit — wasteful
// either way, and a real (if individually tiny) cost if ANTHROPIC_API_KEY is
// set. A 15-minute cache cuts that to ~96 calls/day, matching the cadence of
// the scheduled alert function.
const CACHE_TTL_MS = 15 * 60_000;
let cache: { timestamp: number; limit: number; data: NewsHeadline[] } | null = null;

async function fetchFeed(url: string, source: string): Promise<Omit<NewsHeadline, "sentiment">[]> {
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(6000),
    headers: { "User-Agent": "Mozilla/5.0 (BTC Quant Dashboard)" },
  });
  if (!res.ok) throw new Error(`Feed ${source} respondió ${res.status}`);
  const xml = await res.text();
  const parser = new XMLParser();
  const parsed = parser.parse(xml);
  const rawItems = parsed?.rss?.channel?.item;
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

  return items.slice(0, 8).map((item: any) => ({
    title: String(item.title ?? "").trim(),
    link: String(item.link ?? "").trim(),
    publishedAt: item.pubDate ? new Date(item.pubDate).getTime() : Date.now(),
    source,
  }));
}

export async function getBtcNews(limit = 8): Promise<NewsHeadline[]> {
  const now = Date.now();
  if (cache && cache.limit === limit && now - cache.timestamp < CACHE_TTL_MS) {
    return cache.data;
  }

  let items: Omit<NewsHeadline, "sentiment">[] = [];

  for (const feed of FEEDS) {
    try {
      items = await fetchFeed(feed.url, feed.source);
      if (items.length) break;
    } catch {
      continue; // try next feed
    }
  }

  if (items.length === 0) {
    // Don't cache an empty result — a transient feed failure shouldn't lock
    // the dashboard out of news for a full 15 minutes once the feed recovers.
    return [];
  }

  items = items.slice(0, limit);

  const aiSentiments = await classifyHeadlinesWithClaude(items.map((i) => i.title));

  const result: NewsHeadline[] = items.map((item, idx) => ({
    ...item,
    sentiment: aiSentiments ? aiSentiments[idx] : classifyHeadlineHeuristic(item.title),
  }));

  cache = { timestamp: now, limit, data: result };
  return result;
}

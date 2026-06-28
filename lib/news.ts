import { XMLParser } from "fast-xml-parser";
import { NewsHeadline } from "./types";
import { classifyHeadlineHeuristic, classifyHeadlinesWithClaude } from "./sentiment";

const FEEDS = [
  { url: "https://www.coindesk.com/arc/outboundfeeds/rss/", source: "CoinDesk" },
  { url: "https://cointelegraph.com/rss/tag/bitcoin", source: "Cointelegraph" },
];

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
  let items: Omit<NewsHeadline, "sentiment">[] = [];

  for (const feed of FEEDS) {
    try {
      items = await fetchFeed(feed.url, feed.source);
      if (items.length) break;
    } catch {
      continue; // try next feed
    }
  }

  if (items.length === 0) return [];

  items = items.slice(0, limit);

  const aiSentiments = await classifyHeadlinesWithClaude(items.map((i) => i.title));

  return items.map((item, idx) => ({
    ...item,
    sentiment: aiSentiments ? aiSentiments[idx] : classifyHeadlineHeuristic(item.title),
  }));
}

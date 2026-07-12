import { Candle } from "./types";

/**
 * Bitso public REST client — no API key required for market data endpoints.
 * Rate limit: 60 requests/min per IP (public). We poll every 5 minutes with
 * 2 calls max per cycle, well within that limit.
 *
 * Pair: btc_mxn (BTC priced in Mexican Peso).
 * Prices are returned as strings by Bitso to preserve precision.
 *
 * NOTE: WebSocket is not used here because Netlify Functions are stateless
 * (they shut down after each request, so persistent WS connections are not
 * possible). Instead we poll REST trades and aggregate into 5-min candles.
 */

const BITSO_BASE = "https://api.bitso.com/v3";
const BOOK = "btc_mxn";

// Module-level trade cache: accumulates raw trades between cron invocations
// so we can build candles spanning multiple polling cycles without hitting
// the API more than necessary. Resets when the function instance is recycled.
const tradeCache: {
  trades: BitsoTrade[];
  lastTid: number | null;
} = { trades: [], lastTid: null };

interface BitsoTrade {
  tid: number;
  price: number;   // parsed from string
  amount: number;  // BTC amount, parsed from string
  side: "buy" | "sell"; // maker_side
  timestamp: number; // ms epoch parsed from created_at
}

async function fetchJson(url: string, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { "User-Agent": "btc-quant-dashboard" },
    });
    if (!res.ok) throw new Error(`Bitso respondió ${res.status} en ${url}`);
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

async function fetchRecentTrades(): Promise<BitsoTrade[]> {
  // Bitso returns up to 100 trades per call by default (max is 100 without marker).
  // Use `marker` to paginate forward from last seen tid.
  const url = tradeCache.lastTid
    ? `${BITSO_BASE}/trades/?book=${BOOK}&marker=${tradeCache.lastTid}&sort=asc&limit=100`
    : `${BITSO_BASE}/trades/?book=${BOOK}&limit=100`;

  const json = await fetchJson(url);
  if (!json.success || !Array.isArray(json.payload)) return [];

  return json.payload.map((t: any) => ({
    tid: t.tid,
    price: parseFloat(t.price),
    amount: parseFloat(t.amount),
    side: t.maker_side as "buy" | "sell",
    timestamp: new Date(t.created_at).getTime(),
  }));
}

/**
 * Aggregate raw trades into fixed-width candles.
 * `periodMs` defaults to 5 minutes (300_000 ms).
 */
function aggregateCandles(trades: BitsoTrade[], periodMs = 300_000): Candle[] {
  if (trades.length === 0) return [];

  // Bucket trades by candle-open time (floor to nearest periodMs)
  const buckets = new Map<number, BitsoTrade[]>();
  trades.forEach((t) => {
    const bucketTime = Math.floor(t.timestamp / periodMs) * periodMs;
    if (!buckets.has(bucketTime)) buckets.set(bucketTime, []);
    buckets.get(bucketTime)!.push(t);
  });

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([openTime, ts]) => {
      const prices = ts.map((t) => t.price);
      const open = ts[0].price;
      const close = ts[ts.length - 1].price;
      const high = Math.max(...prices);
      const low = Math.min(...prices);
      const volume = ts.reduce((s, t) => s + t.amount, 0);
      return {
        time: openTime + periodMs - 1, // close time (matches Coinbase convention)
        open,
        high,
        low,
        close,
        volume,
      };
    });
}

/**
 * Main entry point: fetch new trades since last poll, merge into cache,
 * return the last `limit` completed 5-min candles.
 * A candle is "complete" if its close time is before now.
 */
export async function getBitsoCandles(
  limit = 300,
  periodMs = 300_000
): Promise<{ candles: Candle[]; currentPriceMxn: number | null }> {
  const newTrades = await fetchRecentTrades();

  if (newTrades.length > 0) {
    const maxTid = Math.max(...newTrades.map((t) => t.tid));
    tradeCache.lastTid = maxTid;
    // Merge and keep only trades within the last 24h to bound memory usage
    const cutoff = Date.now() - 24 * 60 * 60_000;
    tradeCache.trades = [...tradeCache.trades, ...newTrades].filter(
      (t) => t.timestamp >= cutoff
    );
    // Deduplicate by tid
    const seen = new Set<number>();
    tradeCache.trades = tradeCache.trades.filter((t) => {
      if (seen.has(t.tid)) return false;
      seen.add(t.tid);
      return true;
    });
  }

  const now = Date.now();
  const allCandles = aggregateCandles(tradeCache.trades, periodMs);
  // Only return completed candles (the current in-progress bucket is incomplete)
  const completedCandles = allCandles.filter((c) => c.time < now);
  const currentPriceMxn =
    tradeCache.trades.length > 0
      ? tradeCache.trades[tradeCache.trades.length - 1].price
      : null;

  return {
    candles: completedCandles.slice(-limit),
    currentPriceMxn,
  };
}

/** Lightweight ticker for the current BTC/MXN mid price. */
export async function getBitsoTicker(): Promise<{
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  volume24h: number | null;
}> {
  try {
    const json = await fetchJson(`${BITSO_BASE}/ticker/?book=${BOOK}`, 5000);
    if (!json.success) return { lastPrice: null, bid: null, ask: null, volume24h: null };
    const p = json.payload;
    return {
      lastPrice: parseFloat(p.last),
      bid: parseFloat(p.bid),
      ask: parseFloat(p.ask),
      volume24h: parseFloat(p.volume),
    };
  } catch {
    return { lastPrice: null, bid: null, ask: null, volume24h: null };
  }
}

/** Order book summary for the imbalance check (same logic as Coinbase). */
export async function getBitsoOrderBook(): Promise<{
  bidVolume: number;
  askVolume: number;
  imbalanceRatio: number;
}> {
  const json = await fetchJson(
    `${BITSO_BASE}/order_book/?book=${BOOK}&aggregate=true`
  );
  if (!json.success)
    return { bidVolume: 0, askVolume: 0, imbalanceRatio: 1 };

  const bidVolume = json.payload.bids
    .slice(0, 20)
    .reduce((s: number, o: any) => s + parseFloat(o.amount), 0);
  const askVolume = json.payload.asks
    .slice(0, 20)
    .reduce((s: number, o: any) => s + parseFloat(o.amount), 0);
  return {
    bidVolume,
    askVolume,
    imbalanceRatio: askVolume > 0 ? bidVolume / askVolume : 1,
  };
}

// ============================================================
// PRIVATE API — HMAC-SHA256 authentication
// Only used for read-only endpoints (balance, user trades).
// NO order creation endpoints are used in this file.
// ============================================================

import { createHmac } from "crypto";

function buildAuthHeader(
  apiKey: string,
  apiSecret: string,
  method: "GET" | "POST",
  requestPath: string,
  jsonPayload = ""
): string {
  const nonce = Date.now().toString();
  const message = `${nonce}${method}${requestPath}${jsonPayload}`;
  const signature = createHmac("sha256", apiSecret)
    .update(message)
    .digest("hex");
  return `Bitso ${apiKey}:${nonce}:${signature}`;
}

async function fetchPrivate(
  path: string,
  method: "GET" | "POST" = "GET"
): Promise<any> {
  const apiKey = process.env.BITSO_API_KEY;
  const apiSecret = process.env.BITSO_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error("Faltan BITSO_API_KEY / BITSO_API_SECRET en las variables de entorno");
  }

  const authHeader = buildAuthHeader(apiKey, apiSecret, method, path);

  const res = await fetch(`${BITSO_BASE}${path}`, {
    method,
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      "User-Agent": "btc-quant-dashboard",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) throw new Error(`Bitso private API respondió ${res.status} en ${path}`);
  return await res.json();
}

/** Returns BTC and MXN balances from the authenticated Bitso account. */
export async function getBitsoBalance(): Promise<{
  btc: number;
  mxn: number;
} | null> {
  try {
    const json = await fetchPrivate("/balance/");
    console.log("[bitso balance raw]", JSON.stringify(json).slice(0, 500));
    if (!json.success) {
      console.log("[bitso balance] success=false, error:", json.error);
      return null;
    }
    const balances: any[] = json.payload.balances;
    const btc = balances.find((b: any) => b.currency === "btc");
    const mxn = balances.find((b: any) => b.currency === "mxn");
    return {
      btc: parseFloat(btc?.available ?? "0"),
      mxn: parseFloat(mxn?.available ?? "0"),
    };
  } catch (err: any) {
    console.log("[bitso balance] error:", err?.message);
    return null;
  }
}
/** Returns the last N user trades for btc_mxn (read-only). */
export async function getBitsoUserTrades(limit = 25): Promise<
  {
    tid: string;
    side: "buy" | "sell";
    price: number;
    amount: number;
    feesAmount: number;
    createdAt: number;
  }[]
> {
  try {
    const json = await fetchPrivate(
      `/user_trades/?book=${BOOK}&limit=${limit}&sort=desc`
    );
    if (!json.success) return [];
    return json.payload.map((t: any) => ({
      tid: t.tid,
      side: t.side as "buy" | "sell",
      price: parseFloat(t.price),
      amount: parseFloat(t.major),
      feesAmount: parseFloat(t.fees_amount),
      createdAt: new Date(t.created_at).getTime(),
    }));
  } catch {
    return [];
  }
}

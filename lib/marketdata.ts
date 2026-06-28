import { Candle, DerivativesSnapshot, WhaleSummary } from "./types";

/**
 * Market data client — Coinbase Exchange public API (api.exchange.coinbase.com).
 *
 * WHY COINBASE INSTEAD OF BINANCE: Binance.com returns HTTP 451 ("Unavailable
 * For Legal Reasons") for requests originating from US IP addresses, and
 * Netlify Functions run from US AWS regions by default (changing region
 * requires a Netlify Pro/Enterprise plan). Coinbase is a US-domiciled,
 * US-licensed exchange — it does not geo-block US server IPs, which is
 * exactly the opposite constraint, so it's the more robust free choice for
 * a Netlify-hosted dashboard regardless of hosting plan.
 *
 * Trade-off: Coinbase's public candle granularities are coarser than
 * Binance's (only 1m/5m/15m/1h/6h/1d vs. Binance's full 1m..1M range). See
 * `resolveGranularity()` below for how each UI timeframe maps to one of
 * these. Coinbase also has no perpetual-futures endpoint, so funding
 * rate / open interest are attempted via Kraken Futures' public ticker as a
 * best-effort secondary source (see getDerivativesSnapshot) — if that's
 * also unreachable, those fields just degrade to null, same as before.
 */

const PRODUCT = "BTC-USD";
const COINBASE_BASE = "https://api.exchange.coinbase.com";
const KRAKEN_FUTURES_TICKERS = "https://futures.kraken.com/derivatives/api/v3/tickers";

const cacheStore = new Map<string, { timestamp: number; data: any }>();

function getCached<T>(key: string, ttlMs: number): T | null {
  const hit = cacheStore.get(key);
  if (hit && Date.now() - hit.timestamp < ttlMs) return hit.data as T;
  return null;
}

function setCached(key: string, data: any) {
  cacheStore.set(key, { timestamp: Date.now(), data });
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
    if (!res.ok) throw new Error(`${url} respondió ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

/** Maps the dashboard's full timeframe list to Coinbase's 6 supported granularities. */
const GRANULARITY_MAP: Record<string, { seconds: number; label: string }> = {
  "1m": { seconds: 60, label: "1m" },
  "3m": { seconds: 60, label: "1m" },
  "5m": { seconds: 300, label: "5m" },
  "15m": { seconds: 900, label: "15m" },
  "30m": { seconds: 900, label: "15m" },
  "1h": { seconds: 3600, label: "1h" },
  "2h": { seconds: 3600, label: "1h" },
  "4h": { seconds: 3600, label: "1h" },
  "6h": { seconds: 21600, label: "6h" },
  "8h": { seconds: 21600, label: "6h" },
  "12h": { seconds: 21600, label: "6h" },
  "1d": { seconds: 86400, label: "1d" },
  "1w": { seconds: 86400, label: "1d" },
  "1M": { seconds: 86400, label: "1d" },
};

export function resolveGranularity(interval: string) {
  return GRANULARITY_MAP[interval] ?? GRANULARITY_MAP["15m"];
}

export async function getKlines(interval: string, limit: number): Promise<{ candles: Candle[]; resolvedInterval: string }> {
  const { seconds, label } = resolveGranularity(interval);
  const cacheKey = `candles:${seconds}`;
  const cached = getCached<Candle[]>(cacheKey, 15_000);
  if (cached) return { candles: cached, resolvedInterval: label };

  const raw: number[][] = await fetchJson(
    `${COINBASE_BASE}/products/${PRODUCT}/candles?granularity=${seconds}`
  );
  // Coinbase returns newest-first: [time, low, high, open, close, volume]
  const candles: Candle[] = raw
    .map((c) => ({
      time: c[0] * 1000,
      low: c[1],
      high: c[2],
      open: c[3],
      close: c[4],
      volume: c[5] ?? 0,
    }))
    .sort((a, b) => a.time - b.time)
    .slice(-limit);

  setCached(cacheKey, candles);
  return { candles, resolvedInterval: label };
}

export async function getTicker24h() {
  const cacheKey = "ticker24h";
  const cached = getCached<any>(cacheKey, 15_000);
  if (cached) return cached;

  const [stats, ticker] = await Promise.all([
    fetchJson(`${COINBASE_BASE}/products/${PRODUCT}/stats`),
    fetchJson(`${COINBASE_BASE}/products/${PRODUCT}/ticker`),
  ]);
  const open = parseFloat(stats.open);
  const last = parseFloat(ticker.price ?? stats.last);
  const result = {
    priceChangePct24h: open > 0 ? ((last - open) / open) * 100 : 0,
    high24h: parseFloat(stats.high),
    low24h: parseFloat(stats.low),
    volume24h: parseFloat(stats.volume),
  };
  setCached(cacheKey, result);
  return result;
}

export async function getOrderBookSummary() {
  const cacheKey = "depth";
  const cached = getCached<any>(cacheKey, 15_000);
  if (cached) return cached;

  const book = await fetchJson(`${COINBASE_BASE}/products/${PRODUCT}/book?level=2`);
  const bidVolume = book.bids
    .slice(0, 100)
    .reduce((acc: number, [, size]: string[]) => acc + parseFloat(size), 0);
  const askVolume = book.asks
    .slice(0, 100)
    .reduce((acc: number, [, size]: string[]) => acc + parseFloat(size), 0);
  const result = { bidVolume, askVolume, imbalanceRatio: askVolume > 0 ? bidVolume / askVolume : 1 };
  setCached(cacheKey, result);
  return result;
}

/**
 * Funding rate / open interest, best-effort via Kraken Futures' public
 * ticker (no key required for read-only market data). Long/Short ratio has
 * no equivalent free, non-geo-restricted source, so it's left null —
 * lib/score.ts already treats null derivative fields as "skip this check"
 * rather than failing, so this degrades cleanly.
 */
export async function getDerivativesSnapshot(): Promise<DerivativesSnapshot> {
  const cacheKey = "derivatives";
  const cached = getCached<DerivativesSnapshot>(cacheKey, 30_000);
  if (cached) return cached;

  const result: DerivativesSnapshot = {
    fundingRate: null,
    markPrice: null,
    openInterest: null,
    openInterestChangePct: null,
    longShortRatio: null,
  };

  try {
    const data = await fetchJson(KRAKEN_FUTURES_TICKERS, 5000);
    const ticker = data?.tickers?.find((t: any) => t.symbol === "PF_XBTUSD");
    if (ticker) {
      result.fundingRate = typeof ticker.fundingRate === "number" ? ticker.fundingRate : null;
      result.markPrice = typeof ticker.markPrice === "number" ? ticker.markPrice : null;
      result.openInterest = typeof ticker.openInterest === "number" ? ticker.openInterest : null;
    }
  } catch {
    /* best-effort only — leave nulls if Kraken Futures is unreachable */
  }

  setCached(cacheKey, result);
  return result;
}

/**
 * Whale activity, approximated for free: scan recent public trades and flag
 * any with notional value above a USD threshold. Coinbase's `side` field on
 * the public trades feed indicates the taker's side directly ("buy" or
 * "sell"), so no maker/taker flag-inversion is needed (unlike Binance's
 * `isBuyerMaker`).
 */
export async function getWhaleSummary(
  thresholdUsd = 250_000,
  windowMinutes = 30
): Promise<WhaleSummary> {
  const cacheKey = `whales:${thresholdUsd}:${windowMinutes}`;
  const cached = getCached<WhaleSummary>(cacheKey, 30_000);
  if (cached) return cached;

  let buyVolume = 0;
  let sellVolume = 0;
  let tradeCount = 0;

  try {
    const trades: any[] = await fetchJson(`${COINBASE_BASE}/products/${PRODUCT}/trades`, 6000);
    const cutoff = Date.now() - windowMinutes * 60_000;
    trades.forEach((t) => {
      const ts = new Date(t.time).getTime();
      if (ts < cutoff) return;
      const price = parseFloat(t.price);
      const size = parseFloat(t.size);
      const notional = price * size;
      if (notional < thresholdUsd) return;
      tradeCount++;
      if (t.side === "buy") buyVolume += size;
      else sellVolume += size;
    });
  } catch {
    /* leave at zero if the trades endpoint is unreachable */
  }

  const result: WhaleSummary = {
    windowMinutes,
    largeTradeThresholdUsd: thresholdUsd,
    buyVolume,
    sellVolume,
    netDirection: buyVolume > sellVolume * 1.1 ? "bullish" : sellVolume > buyVolume * 1.1 ? "bearish" : "neutral",
    tradeCount,
  };
  setCached(cacheKey, result);
  return result;
}

export async function getLiveBtcData(interval = "15m", limit = 300) {
  const [{ candles, resolvedInterval }, ticker, orderBook] = await Promise.all([
    getKlines(interval, limit),
    getTicker24h(),
    getOrderBookSummary(),
  ]);
  return { candles, resolvedInterval, ...ticker, orderBook };
}

import { Candle, DerivativesSnapshot, WhaleSummary } from "./types";

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

export async function getKlines(
  interval: string,
  limit: number
): Promise<{ candles: Candle[]; resolvedInterval: string }> {
  const { seconds, label } = resolveGranularity(interval);
  const cacheKey = `candles:${seconds}`;
  const cached = getCached<Candle[]>(cacheKey, 15_000);
  if (cached) return { candles: cached, resolvedInterval: label };

  const raw: number[][] = await fetchJson(
    `${COINBASE_BASE}/products/${PRODUCT}/candles?granularity=${seconds}`
  );

  const nowMs = Date.now();
  const periodMs = seconds * 1000;

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
    // FIX #2: Exclude the current in-progress (incomplete) candle.
    // A candle is complete only when its close time has passed.
    // Coinbase `time` is the OPEN time, so we exclude candles where
    // open_time + period > now (i.e. the candle hasn't closed yet).
    .filter((c) => c.time + periodMs <= nowMs)
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

  const book = await fetchJson(
    `${COINBASE_BASE}/products/${PRODUCT}/book?level=2`
  );
  const bidVolume = book.bids
    .slice(0, 100)
    .reduce((acc: number, [, size]: string[]) => acc + parseFloat(size), 0);
  const askVolume = book.asks
    .slice(0, 100)
    .reduce((acc: number, [, size]: string[]) => acc + parseFloat(size), 0);
  const result = {
    bidVolume,
    askVolume,
    imbalanceRatio: askVolume > 0 ? bidVolume / askVolume : 1,
  };
  setCached(cacheKey, result);
  return result;
}

/**
 * FIX #1 — Kraken Futures funding rate correct interpretation.
 *
 * Kraken returns TWO funding rate fields in the /tickers response:
 *
 *   fundingRate          — the absolute rate per second (very small number,
 *                          e.g. 1.18e-7). NOT useful for display or scoring.
 *
 *   relativeFundingRate  — the rate as a fraction of the mark price per
 *                          funding period (1h for PF_XBTUSD). This is the
 *                          number comparable to Binance's funding rate.
 *                          e.g. 0.0001 = 0.01% per hour.
 *
 * The previous code used `fundingRate` (absolute per second) and multiplied
 * by 100, producing absurd values like 18.66% which is impossible for any
 * liquid perpetual. The score's Derivados category was voting with corrupted
 * data every cycle.
 *
 * FIX: Use `relativeFundingRate` directly. Multiply by 100 for display as %.
 *
 * Open Interest: Kraken returns OI in USD-denominated contracts (each
 * contract = $1 USD). To convert to BTC, divide by the mark price.
 * The previous code displayed raw contract count as "BTC" which was wrong.
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

    // PI_XBTUSD is the liquid BTC perpetual on Kraken (83k+ vol/day, 3.6M OI).
    // PF_XBTUSD is illiquid (~2k vol/day, 1.9k OI) and returns garbage fundingRate values.
    const ticker = data?.tickers?.find(
      (t: any) => t.symbol === "PI_XBTUSD"
    );

    if (ticker) {
      // PI_XBTUSD returns fundingRate in per-SECOND format (e.g. -4.09e-10).
      // Multiply × 3600 to get the rate per hour, which is comparable to
      // Binance's funding rate (expressed per 8h period).
      // Example: -4.09e-10 × 3600 = -1.47e-6 per hour ≈ -0.000147% — normal for BTC.
      const fundingRatePerSecond =
        typeof ticker.fundingRate === "number" ? ticker.fundingRate : null;

      result.fundingRate =
        fundingRatePerSecond !== null ? fundingRatePerSecond * 3600 : null;

      result.markPrice =
        typeof ticker.markPrice === "number" ? ticker.markPrice : null;

      // openInterest for PI_XBTUSD is in USD (not BTC contracts).
      // Convert to BTC by dividing by markPrice.
      if (
        typeof ticker.openInterest === "number" &&
        result.markPrice !== null &&
        result.markPrice > 0
      ) {
        result.openInterest = ticker.openInterest / result.markPrice;
      } else if (typeof ticker.openInterest === "number") {
        result.openInterest = ticker.openInterest;
      }
    }
  } catch {
    /* best-effort only */
  }

  setCached(cacheKey, result);
  return result;
}

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
    const trades: any[] = await fetchJson(
      `${COINBASE_BASE}/products/${PRODUCT}/trades`,
      6000
    );
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
    /* leave at zero */
  }

  const result: WhaleSummary = {
    windowMinutes,
    largeTradeThresholdUsd: thresholdUsd,
    buyVolume,
    sellVolume,
    netDirection:
      buyVolume > sellVolume * 1.1
        ? "bullish"
        : sellVolume > buyVolume * 1.1
          ? "bearish"
          : "neutral",
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

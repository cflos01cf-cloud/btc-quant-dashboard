import { Candle, DerivativesSnapshot, WhaleSummary } from "./types";

const SYMBOL = "BTCUSDT";
const BINANCE_BASE = "https://api.binance.com";
const FUTURES_BASE = "https://fapi.binance.com";
const FUTURES_DATA_BASE = "https://fapi.binance.com/futures/data";

// Module-level cache. Survives across requests as long as the serverless
// function instance stays warm — cuts down on calls when several browser
// tabs poll at once. Binance's public limits are far more generous than
// TwelveData's, but we still don't hammer it on every page load.
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
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`Binance respondió ${res.status} en ${url}`);
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

export async function getKlines(interval: string, limit: number): Promise<Candle[]> {
  const cacheKey = `klines:${interval}:${limit}`;
  const cached = getCached<Candle[]>(cacheKey, 15_000);
  if (cached) return cached;

  const raw: any[] = await fetchJson(
    `${BINANCE_BASE}/api/v3/klines?symbol=${SYMBOL}&interval=${interval}&limit=${limit}`
  );
  const candles = raw.map((k) => ({
    time: k[6],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
  setCached(cacheKey, candles);
  return candles;
}

export async function getTicker24h() {
  const cacheKey = "ticker24h";
  const cached = getCached<any>(cacheKey, 15_000);
  if (cached) return cached;

  const t = await fetchJson(`${BINANCE_BASE}/api/v3/ticker/24hr?symbol=${SYMBOL}`);
  const result = {
    priceChangePct24h: parseFloat(t.priceChangePercent),
    high24h: parseFloat(t.highPrice),
    low24h: parseFloat(t.lowPrice),
    volume24h: parseFloat(t.volume),
  };
  setCached(cacheKey, result);
  return result;
}

export async function getOrderBookSummary() {
  const cacheKey = "depth";
  const cached = getCached<any>(cacheKey, 15_000);
  if (cached) return cached;

  const depth = await fetchJson(`${BINANCE_BASE}/api/v3/depth?symbol=${SYMBOL}&limit=100`);
  const bidVolume = depth.bids.reduce((acc: number, [, qty]: string[]) => acc + parseFloat(qty), 0);
  const askVolume = depth.asks.reduce((acc: number, [, qty]: string[]) => acc + parseFloat(qty), 0);
  const result = { bidVolume, askVolume, imbalanceRatio: askVolume > 0 ? bidVolume / askVolume : 1 };
  setCached(cacheKey, result);
  return result;
}

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
    const f = await fetchJson(`${FUTURES_BASE}/fapi/v1/premiumIndex?symbol=${SYMBOL}`, 5000);
    result.fundingRate = parseFloat(f.lastFundingRate);
    result.markPrice = parseFloat(f.markPrice);
  } catch {
    /* funding is supplementary — keep nulls if fapi is unreachable */
  }

  try {
    const oiHist: any[] = await fetchJson(
      `${FUTURES_DATA_BASE}/openInterestHist?symbol=${SYMBOL}&period=15m&limit=8`,
      5000
    );
    if (oiHist.length >= 2) {
      const first = parseFloat(oiHist[0].sumOpenInterest);
      const last = parseFloat(oiHist[oiHist.length - 1].sumOpenInterest);
      result.openInterest = last;
      result.openInterestChangePct = first > 0 ? ((last - first) / first) * 100 : null;
    }
  } catch {
    /* same — degrade gracefully */
  }

  try {
    const lsRatio: any[] = await fetchJson(
      `${FUTURES_DATA_BASE}/globalLongShortAccountRatio?symbol=${SYMBOL}&period=15m&limit=1`,
      5000
    );
    if (lsRatio.length) {
      result.longShortRatio = parseFloat(lsRatio[0].longShortRatio);
    }
  } catch {
    /* same */
  }

  setCached(cacheKey, result);
  return result;
}

/**
 * Whale activity, approximated for free: scan recent aggregated trades and
 * flag any with notional value above a USD threshold. `m` (isBuyerMaker)
 * true means the trade was taker-initiated as a SELL (bearish pressure);
 * false means taker-initiated as a BUY (bullish pressure) — standard
 * Binance convention.
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
    const trades: any[] = await fetchJson(
      `${BINANCE_BASE}/api/v3/aggTrades?symbol=${SYMBOL}&limit=1000`,
      6000
    );
    const cutoff = Date.now() - windowMinutes * 60_000;
    trades.forEach((t) => {
      if (t.T < cutoff) return;
      const price = parseFloat(t.p);
      const qty = parseFloat(t.q);
      const notional = price * qty;
      if (notional < thresholdUsd) return;
      tradeCount++;
      if (t.m) sellVolume += qty;
      else buyVolume += qty;
    });
  } catch {
    /* leave at zero if aggTrades is unreachable */
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
  const [candles, ticker, orderBook] = await Promise.all([
    getKlines(interval, limit),
    getTicker24h(),
    getOrderBookSummary(),
  ]);
  return { candles, ...ticker, orderBook };
}

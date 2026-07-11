import type { Config } from "@netlify/functions";
import { getBitsoCandles, getBitsoOrderBook, getBitsoTicker } from "../../lib/bitso";
import { buildIndicatorSnapshot } from "../../lib/indicators";
import { detectSmcEvents } from "../../lib/smc";
import { getFearGreedIndex } from "../../lib/feargreed";
import { getBtcNews } from "../../lib/news";
import { computeMaestroScore } from "../../lib/score";
import { buildSignalRecord, listOpenSignals, saveSignal } from "../../lib/blobstore";
import { DerivativesSnapshot, WhaleSummary } from "../../lib/types";

/**
 * Runs every 5 minutes. Fetches BTC/MXN data from Bitso, runs the same
 * Prompt Maestro score engine used for Coinbase data, and records any
 * qualifying signal (score ≥ 60) in Netlify Blobs for later comparison.
 *
 * Why score ≥ 60 instead of ≥ 85?
 * We want to accumulate 30-40 closed signals per source within 4-6 weeks.
 * With the 85/100 threshold, signals are rare by design. Lowering to 60
 * for tracking purposes gives us enough data points to compare signal
 * quality across sources while still filtering pure noise. The 85/100
 * rule still governs the live COMPRAR/VENDER alerts to Telegram.
 *
 * NO ORDER ENDPOINTS are used or imported anywhere in this file.
 */

const SIGNAL_SCORE_THRESHOLD = 60;
// Don't record a new signal if one from the same source is already open —
// we want to track discrete, non-overlapping signals for clean comparison.
const MAX_CONCURRENT_OPEN = 1;

export default async () => {
  try {
    // 1. Fetch Bitso market data
    const [{ candles, currentPriceMxn }, ticker, orderBook] = await Promise.all([
      getBitsoCandles(300, 300_000),
      getBitsoTicker(),
      getBitsoOrderBook().catch(() => ({
        bidVolume: 0,
        askVolume: 0,
        imbalanceRatio: 1,
      })),
    ]);

    if (candles.length < 60) {
      // Not enough candles yet to compute reliable indicators — this is normal
      // on first few invocations while the trade cache builds up.
      return new Response(
        JSON.stringify({ ok: true, reason: "insufficient_candles", count: candles.length }),
        { status: 200 }
      );
    }

    const priceRef = currentPriceMxn ?? candles[candles.length - 1].close;

    // 2. Shared sentiment data (same as Coinbase tracker — no need to fetch twice)
    const [fearGreed, news] = await Promise.all([
      getFearGreedIndex().catch(() => null),
      getBtcNews(8).catch(() => []),
    ]);

    // 3. Derivatives not available for Bitso spot (btc_mxn has no futures market)
    const derivatives: DerivativesSnapshot = {
      fundingRate: null,
      markPrice: null,
      openInterest: null,
      openInterestChangePct: null,
      longShortRatio: null,
    };

    // 4. Whale approximation from order book imbalance (no aggTrades on Bitso public API)
    const whales: WhaleSummary = {
      windowMinutes: 5,
      largeTradeThresholdUsd: 0,
      buyVolume: orderBook.bidVolume,
      sellVolume: orderBook.askVolume,
      netDirection:
        orderBook.imbalanceRatio > 1.1
          ? "bullish"
          : orderBook.imbalanceRatio < 0.9
            ? "bearish"
            : "neutral",
      tradeCount: 0,
    };

    // 5. Run the scoring engine (identical to Coinbase path)
    const indicators = buildIndicatorSnapshot(candles);
    const smcEvents = detectSmcEvents(candles);
    const maestro = computeMaestroScore({
      indicators,
      candles,
      orderBook,
      smcEvents,
      whales,
      derivatives,
      fearGreed,
      news,
    });

    // 6. Decide whether to record a signal
    if (
      maestro.verdict === "NO_OPERAR" ||
      maestro.total < SIGNAL_SCORE_THRESHOLD
    ) {
      return new Response(
        JSON.stringify({
          ok: true,
          recorded: false,
          reason: "below_threshold",
          score: maestro.total,
          verdict: maestro.verdict,
        }),
        { status: 200 }
      );
    }

    // Check if there's already an open signal from Bitso
    const openSignals = await listOpenSignals("bitso");
    if (openSignals.length >= MAX_CONCURRENT_OPEN) {
      return new Response(
        JSON.stringify({
          ok: true,
          recorded: false,
          reason: "already_open",
          openCount: openSignals.length,
          score: maestro.total,
        }),
        { status: 200 }
      );
    }

    // 7. Record the signal
    const signal = buildSignalRecord({
      source: "bitso",
      verdict: maestro.verdict,
      direction: maestro.direction as "bullish" | "bearish",
      score: maestro.total,
      priceReference: priceRef,
      currency: "MXN",
      atr: indicators.atr14,
    });

    await saveSignal(signal);

    return new Response(
      JSON.stringify({
        ok: true,
        recorded: true,
        signalId: signal.id,
        verdict: maestro.verdict,
        score: maestro.total,
        priceRef,
      }),
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[bitso-tracker] error:", err?.message);
    return new Response(
      JSON.stringify({ ok: false, error: err?.message }),
      { status: 200 }
    );
  }
};

export const config: Config = {
  schedule: "*/5 * * * *",
};

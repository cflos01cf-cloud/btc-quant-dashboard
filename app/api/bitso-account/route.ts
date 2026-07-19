import { NextResponse } from "next/server";
import { getBitsoBalance, getBitsoTicker, getBitsoUserTrades } from "@/lib/bitso";

export const dynamic = "force-dynamic";

/**
 * FIX #8 — Cache /api/bitso-account for 30 seconds.
 *
 * Previous: no cache — every dashboard poll (every 20s) made 3 authenticated
 * Bitso API calls, risking hitting the 300 RPM private rate limit if multiple
 * browser tabs were open, and unnecessarily burning Netlify function time.
 *
 * Fix: simple in-module cache with 30s TTL. Balance and trades don't change
 * faster than that in a shadow trading context. The ticker refreshes more
 * often but 30s is fine for display purposes.
 */

interface CachedPayload {
  data: any;
  cachedAt: number;
}

let cache: CachedPayload | null = null;
const CACHE_TTL_MS = 30_000;

export async function GET() {
  // Return cached response if still fresh
  if (cache && Date.now() - cache.cachedAt < CACHE_TTL_MS) {
    return NextResponse.json({ ...cache.data, fromCache: true });
  }

  try {
    const [balanceResult, tickerResult, tradesResult] = await Promise.allSettled([
      getBitsoBalance(),
      getBitsoTicker(),
      getBitsoUserTrades(10),
    ]);

    const balance = balanceResult.status === "fulfilled" ? balanceResult.value : null;
    const balanceError =
      balanceResult.status === "rejected" ? balanceResult.reason?.message : null;
    const tickerData =
      tickerResult.status === "fulfilled"
        ? tickerResult.value
        : { lastPrice: null, bid: null, ask: null, spread: null, volume24h: null };
    const tradesData =
      tradesResult.status === "fulfilled" ? tradesResult.value : [];

    const btcValueMxn =
      balance && tickerData.lastPrice ? balance.btc * tickerData.lastPrice : null;
    const totalMxn =
      balance && btcValueMxn !== null ? balance.mxn + btcValueMxn : null;

    const payload = {
      ok: true,
      fetchedAt: Date.now(),
      balance,
      balanceError,
      ticker: {
        lastPrice: tickerData.lastPrice,
        bid: tickerData.bid,
        ask: tickerData.ask,
        spread:
          tickerData.ask && tickerData.bid ? tickerData.ask - tickerData.bid : null,
        volume24h: tickerData.volume24h,
      },
      portfolio: { btcValueMxn, totalMxn },
      recentTrades: tradesData,
      fromCache: false,
    };

    // Store in cache
    cache = { data: payload, cachedAt: Date.now() };

    return NextResponse.json(payload);
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Error desconocido" },
      { status: 500 }
    );
  }
}

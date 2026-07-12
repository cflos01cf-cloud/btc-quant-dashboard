import { NextResponse } from "next/server";
import { getBitsoBalance, getBitsoTicker, getBitsoUserTrades } from "@/lib/bitso";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [balance, ticker, trades] = await Promise.all([
      getBitsoBalance(),
      getBitsoTicker(),
      getBitsoUserTrades(10),
    ]);

    // Calculate portfolio value in MXN
    const btcValueMxn =
      balance && ticker.lastPrice
        ? balance.btc * ticker.lastPrice
        : null;

    const totalMxn =
      balance && btcValueMxn !== null
        ? balance.mxn + btcValueMxn
        : null;

    return NextResponse.json({
      ok: true,
      fetchedAt: Date.now(),
      balance,
      ticker: {
        lastPrice: ticker.lastPrice,
        bid: ticker.bid,
        ask: ticker.ask,
        spread:
          ticker.ask && ticker.bid ? ticker.ask - ticker.bid : null,
        volume24h: ticker.volume24h,
      },
      portfolio: {
        btcValueMxn,
        totalMxn,
      },
      recentTrades: trades,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Error desconocido" },
      { status: 500 }
    );
  }
}

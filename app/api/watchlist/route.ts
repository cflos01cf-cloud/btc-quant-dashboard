import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const symbolsParam = req.nextUrl.searchParams.get("symbols") || "";
  const symbols = symbolsParam
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 15); // sane upper bound

  if (symbols.length === 0) return NextResponse.json({ tickers: [] });

  try {
    const results = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`, {
            cache: "no-store",
            signal: AbortSignal.timeout(6000),
          });
          if (!res.ok) return null;
          const t = await res.json();
          return {
            symbol,
            price: parseFloat(t.lastPrice),
            changePct24h: parseFloat(t.priceChangePercent),
          };
        } catch {
          return null;
        }
      })
    );
    return NextResponse.json({ tickers: results.filter(Boolean) });
  } catch {
    return NextResponse.json({ tickers: [] });
  }
}

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const COINBASE_BASE = "https://api.exchange.coinbase.com";

/** "ETHUSDT" (Binance-style, what the UI lets people type) -> "ETH-USD" (Coinbase product id) */
function toCoinbaseProductId(symbol: string): string {
  const base = symbol.endsWith("USDT") ? symbol.slice(0, -4) : symbol.replace(/USD$/, "");
  return `${base}-USD`;
}

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
          const productId = toCoinbaseProductId(symbol);
          const [stats, ticker] = await Promise.all([
            fetch(`${COINBASE_BASE}/products/${productId}/stats`, {
              cache: "no-store",
              signal: AbortSignal.timeout(6000),
            }).then((r) => (r.ok ? r.json() : null)),
            fetch(`${COINBASE_BASE}/products/${productId}/ticker`, {
              cache: "no-store",
              signal: AbortSignal.timeout(6000),
            }).then((r) => (r.ok ? r.json() : null)),
          ]);
          if (!stats || !ticker) return null;
          const open = parseFloat(stats.open);
          const price = parseFloat(ticker.price ?? stats.last);
          return {
            symbol,
            price,
            changePct24h: open > 0 ? ((price - open) / open) * 100 : 0,
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

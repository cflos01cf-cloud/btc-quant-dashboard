import { NextResponse } from "next/server";
import { computeStats, listSignals } from "@/lib/blobstore";
import { ComparePayload } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [coinbaseSignals, bitsoSignals] = await Promise.all([
      listSignals("coinbase", 200),
      listSignals("bitso", 200),
    ]);

    const coinbaseStats = coinbaseSignals.length > 0
      ? computeStats(coinbaseSignals)
      : {
          source: "coinbase" as const,
          totalSignals: 0,
          closedSignals: 0,
          winRate: null,
          avgScoreOnWins: null,
          avgScoreOnLosses: null,
          expectancyPct: null,
          byScoreBucket: [],
        };

    const bitsoStats = bitsoSignals.length > 0
      ? computeStats(bitsoSignals)
      : {
          source: "bitso" as const,
          totalSignals: 0,
          closedSignals: 0,
          winRate: null,
          avgScoreOnWins: null,
          avgScoreOnLosses: null,
          expectancyPct: null,
          byScoreBucket: [],
        };

    const allSignals = [...coinbaseSignals, ...bitsoSignals];
    const openSignals = allSignals.filter((s) => s.status === "open");
    const recentClosed = allSignals
      .filter((s) => s.status !== "open" && s.closedAt !== null)
      .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
      .slice(0, 20);

    const payload: ComparePayload = {
      coinbase: coinbaseStats,
      bitso: bitsoStats,
      openSignals,
      recentClosed,
      fetchedAt: Date.now(),
    };

    return NextResponse.json(payload);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Error desconocido" },
      { status: 500 }
    );
  }
}

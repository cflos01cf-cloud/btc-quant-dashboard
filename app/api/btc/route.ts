import { NextRequest, NextResponse } from "next/server";
import {
  getDerivativesSnapshot,
  getLiveBtcData,
  getWhaleSummary,
  resolveGranularity,
} from "@/lib/marketdata";
import {
  buildDemoCandles,
  buildDemoDerivatives,
  buildDemoFearGreed,
  buildDemoNews,
  buildDemoOrderBook,
  buildDemoWhales,
} from "@/lib/demoData";
import { buildIndicatorSnapshot } from "@/lib/indicators";
import { detectSmcEvents } from "@/lib/smc";
import { getFearGreedIndex } from "@/lib/feargreed";
import { getBtcNews } from "@/lib/news";
import { computeMaestroScore } from "@/lib/score";
import {
  BtcDashboardPayload,
  Candle,
  DerivativesSnapshot,
  FearGreed,
  NewsHeadline,
  WhaleSummary,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 25;

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("mode") === "demo" ? "demo" : "live";
  const interval = req.nextUrl.searchParams.get("interval") || "15m";

  if (mode === "demo") {
    return NextResponse.json(
      buildPayload({
        source: "demo",
        candles: buildDemoCandles(300),
        orderBook: buildDemoOrderBook(),
        derivatives: buildDemoDerivatives(),
        whales: buildDemoWhales(),
        fearGreed: buildDemoFearGreed(),
        news: buildDemoNews(),
        priceChangePct24h: 0,
        high24h: 0,
        low24h: 0,
        volume24h: 0,
        interval,
        resolvedInterval: resolveGranularity(interval).label,
        dataNotes: ["Modo demo: todos los datos son simulados."],
      })
    );
  }

  try {
    const base = await getLiveBtcData(interval, 300);
    const dataNotes: string[] = [];

    // Each secondary data source is fetched independently with its own
    // fallback, so one slow/unreachable API (news RSS, futures data) never
    // takes down the whole dashboard — it just degrades that one category.
    const [derivatives, whales, fearGreed, news] = await Promise.all([
      safeFetch(getDerivativesSnapshot(), buildDemoDerivatives(), "Derivados (funding/OI vía Kraken Futures) no disponibles en este momento.", dataNotes),
      safeFetch(getWhaleSummary(), buildDemoWhales(), "Datos de ballenas no disponibles en este momento.", dataNotes),
      safeFetch(getFearGreedIndex(), null as FearGreed | null, "Fear & Greed Index no disponible en este momento.", dataNotes),
      safeFetch(getBtcNews(8), [] as NewsHeadline[], "Noticias no disponibles en este momento.", dataNotes),
    ]);

    return NextResponse.json(
      buildPayload({
        source: "live",
        candles: base.candles,
        orderBook: base.orderBook,
        derivatives,
        whales,
        fearGreed,
        news,
        priceChangePct24h: base.priceChangePct24h,
        high24h: base.high24h,
        low24h: base.low24h,
        volume24h: base.volume24h,
        interval,
        resolvedInterval: base.resolvedInterval,
        dataNotes,
      })
    );
  } catch (err: any) {
    return NextResponse.json(
      buildPayload({
        source: "demo",
        warning: `No se pudo conectar a la fuente de datos (${err?.message || "error desconocido"}). Mostrando datos simulados.`,
        candles: buildDemoCandles(300),
        orderBook: buildDemoOrderBook(),
        derivatives: buildDemoDerivatives(),
        whales: buildDemoWhales(),
        fearGreed: buildDemoFearGreed(),
        news: buildDemoNews(),
        priceChangePct24h: 0,
        high24h: 0,
        low24h: 0,
        volume24h: 0,
        interval,
        resolvedInterval: resolveGranularity(interval).label,
        dataNotes: ["Fallback completo a modo demo por fallo de conexión con la fuente de datos."],
      })
    );
  }
}

async function safeFetch<T>(
  promise: Promise<T>,
  fallback: T,
  noteOnFail: string,
  notes: string[]
): Promise<T> {
  try {
    return await promise;
  } catch {
    notes.push(noteOnFail);
    return fallback;
  }
}

function buildPayload(args: {
  source: "live" | "demo";
  warning?: string;
  candles: Candle[];
  orderBook: { bidVolume: number; askVolume: number; imbalanceRatio: number };
  derivatives: DerivativesSnapshot;
  whales: WhaleSummary;
  fearGreed: FearGreed | null;
  news: NewsHeadline[];
  priceChangePct24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  interval: string;
  resolvedInterval: string;
  dataNotes: string[];
}): BtcDashboardPayload {
  const indicators = buildIndicatorSnapshot(args.candles);
  const smcEvents = detectSmcEvents(args.candles);
  const maestro = computeMaestroScore({
    indicators,
    candles: args.candles,
    orderBook: args.orderBook,
    smcEvents,
    whales: args.whales,
    derivatives: args.derivatives,
    fearGreed: args.fearGreed,
    news: args.news,
  });

  return {
    source: args.source,
    warning: args.warning,
    fetchedAt: Date.now(),
    symbol: "BTC/USD",
    interval: args.interval,
    resolvedInterval: args.resolvedInterval,
    priceChangePct24h: args.priceChangePct24h,
    high24h: args.high24h,
    low24h: args.low24h,
    volume24h: args.volume24h,
    orderBook: args.orderBook,
    indicators,
    smcEvents,
    whales: args.whales,
    derivatives: args.derivatives,
    fearGreed: args.fearGreed,
    news: args.news,
    maestro,
    candles: args.candles.slice(-150),
    dataNotes: args.dataNotes,
  };
}

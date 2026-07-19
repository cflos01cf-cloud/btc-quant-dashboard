import {
  Candle,
  CategoryScore,
  DerivativesSnapshot,
  Direction,
  FearGreed,
  IndicatorSnapshot,
  MaestroScore,
  NewsHeadline,
  ScoreCheck,
  SmcEvent,
  Verdict,
  WhaleSummary,
} from "./types";

const THRESHOLD = 85;

function gradeCategory(
  id: string,
  label: string,
  checks: ScoreCheck[],
  max: number
): CategoryScore {
  if (checks.length === 0) return { id, label, points: 0, max, direction: "neutral", checks: [] };
  const totalWeight = checks.reduce((s, c) => s + c.weight, 0) || 1;
  const bull = checks.filter((c) => c.direction === "bullish").reduce((s, c) => s + c.weight, 0);
  const bear = checks.filter((c) => c.direction === "bearish").reduce((s, c) => s + c.weight, 0);
  const direction: Direction = bull > bear ? "bullish" : bear > bull ? "bearish" : "neutral";
  const aligned = direction === "bullish" ? bull : direction === "bearish" ? bear : 0;
  const points = max * (aligned / totalWeight);
  return { id, label, points, max, direction, checks };
}

/**
 * FIX #7 — Market regime detection.
 *
 * Previous engine only knew bullish/bearish. In a ranging/consolidating
 * market it would alternate randomly producing false signals. Now it
 * detects 5 regimes and adjusts scoring accordingly:
 *
 *   trending_up    → normal bullish scoring
 *   trending_down  → normal bearish scoring
 *   ranging        → score halved; signals blocked (ADX < 20 + BB squeeze)
 *   breakout_up    → 1.2x bonus (high conviction emerging trend)
 *   breakout_down  → 1.2x bonus
 */
type Regime =
  | "trending_up"
  | "trending_down"
  | "ranging"
  | "breakout_up"
  | "breakout_down";

function detectRegime(ind: IndicatorSnapshot, candles: Candle[]): Regime {
  const last = candles[candles.length - 1];
  const prev = candles[Math.max(0, candles.length - 5)];

  // Band width relative to price — squeeze = < 1.5%
  const bandWidth = ind.bbUpper - ind.bbLower;
  const squeeze = bandWidth / ind.bbMid < 0.015;

  // ADX < 20 = no trend
  const noTrend = ind.adx14 < 20;

  if (noTrend && squeeze) return "ranging";

  const priceMove = (last.close - prev.close) / prev.close;
  const prevBandWidth = (ind.bbUpper - ind.bbLower) / ind.bbMid;

  if (!noTrend) {
    // Expanding bands + price breaking out = breakout
    if (priceMove > 0.01 && prevBandWidth > 0.015) return "breakout_up";
    if (priceMove < -0.01 && prevBandWidth > 0.015) return "breakout_down";
    return ind.diPlus > ind.diMinus ? "trending_up" : "trending_down";
  }

  return "ranging";
}

/**
 * FIX #6 — Removed double counting between Tendencia and Smart Money.
 *
 * Previous issue: BOS/CHOCH (Smart Money) and EMA200/EMA cross (Tendencia)
 * both vote on "is the market going up/down long-term?" — the same question,
 * twice, with 20+20 = 40 pts weight.
 *
 * Fix: Smart Money now focuses exclusively on SHORT-TERM price action
 * microstructure (FVG, liquidity sweeps, order blocks, whale activity) —
 * NOT on market structure (BOS/CHOCH). BOS/CHOCH is moved to Tendencia
 * where it belongs conceptually (it IS a trend continuation/change signal).
 * Smart Money max is reduced from 20 to 15 pts to reflect this narrower scope.
 * The freed 5 pts are redistributed to Volumen (now 20 pts) to give volume
 * confirmation more weight — crucial for crypto.
 *
 * New point distribution (still 100 total):
 *   Tendencia      25 (was 20) — adds BOS/CHOCH
 *   Momentum       15
 *   Volumen        20 (was 15)
 *   Smart Money    10 (was 20) — FVG, sweeps, OB, whales only
 *   Sentimiento    10
 *   Derivados      10
 *   Noticias       10
 *   ─────────────
 *   Total         100
 */

function scoreTendencia(ind: IndicatorSnapshot, smcEvents: SmcEvent[]): CategoryScore {
  const checks: ScoreCheck[] = [
    {
      label: "Precio vs EMA200",
      weight: 6,
      direction: ind.price > ind.ema200 ? "bullish" : "bearish",
      detail: `Precio ${ind.price > ind.ema200 ? "sobre" : "bajo"} EMA200 (${ind.ema200.toFixed(0)})`,
    },
    {
      label: "Cruce EMA50/EMA200",
      weight: 6,
      direction: ind.ema50 > ind.ema200 ? "bullish" : "bearish",
      detail: ind.ema50 > ind.ema200 ? "Golden Cross activo" : "Death Cross activo",
    },
    {
      label: "ADX(14) + DI",
      weight: 5,
      direction:
        ind.adx14 > 20 && ind.diPlus > ind.diMinus
          ? "bullish"
          : ind.adx14 > 20 && ind.diMinus > ind.diPlus
            ? "bearish"
            : "neutral",
      detail: `ADX ${ind.adx14.toFixed(1)} · DI+ ${ind.diPlus.toFixed(1)} / DI- ${ind.diMinus.toFixed(1)}`,
    },
    {
      label: "Supertrend",
      weight: 5,
      direction: ind.supertrendDirection,
      detail: `Supertrend en ${ind.supertrendValue.toFixed(0)} (${ind.supertrendDirection})`,
    },
  ];

  // BOS/CHOCH moved here from Smart Money (they are trend structure signals)
  const bosChoch = smcEvents.filter(
    (e) => e.type === "BOS" || e.type === "CHOCH"
  );
  if (bosChoch.length > 0) {
    const latest = bosChoch[bosChoch.length - 1];
    checks.push({
      label: latest.label,
      weight: 3,
      direction: latest.direction,
      detail: latest.detail,
    });
  }

  return gradeCategory("tendencia", "Tendencia", checks, 25);
}

function scoreMomentum(ind: IndicatorSnapshot): CategoryScore {
  const stochDir: Direction =
    ind.stochRsiK > ind.stochRsiD && ind.stochRsiK < 80
      ? "bullish"
      : ind.stochRsiK < ind.stochRsiD && ind.stochRsiK > 20
        ? "bearish"
        : "neutral";
  const checks: ScoreCheck[] = [
    {
      label: "RSI(14)",
      weight: 4,
      direction: ind.rsi14 > 55 ? "bullish" : ind.rsi14 < 45 ? "bearish" : "neutral",
      detail: `RSI ${ind.rsi14.toFixed(1)}`,
    },
    {
      label: "MACD",
      weight: 4,
      direction: ind.macd > ind.macdSignal ? "bullish" : "bearish",
      detail: `Histograma ${ind.macdHist >= 0 ? "+" : ""}${ind.macdHist.toFixed(1)}`,
    },
    {
      label: "Stochastic RSI",
      weight: 4,
      direction: stochDir,
      detail: `%K ${ind.stochRsiK.toFixed(0)} / %D ${ind.stochRsiD.toFixed(0)}`,
    },
    {
      label: "Parabolic SAR",
      weight: 3,
      direction: ind.parabolicSarDirection,
      detail: `SAR en ${ind.parabolicSar.toFixed(0)}`,
    },
  ];
  return gradeCategory("momentum", "Momentum", checks, 15);
}

function scoreVolumen(
  ind: IndicatorSnapshot,
  lastCandleUp: boolean,
  orderBook: { imbalanceRatio: number }
): CategoryScore {
  const volAboveAvg = ind.lastVolume > ind.avgVolume20 * 1.05;
  const volDir: Direction = volAboveAvg
    ? lastCandleUp
      ? "bullish"
      : "bearish"
    : ind.obvSlope;

  const checks: ScoreCheck[] = [
    {
      label: "Confirmación por volumen",
      weight: 5,
      direction: volDir,
      detail: volAboveAvg
        ? `Volumen ${(ind.lastVolume / ind.avgVolume20).toFixed(1)}x el promedio`
        : `Volumen normal — dirección por OBV (${ind.obvSlope})`,
    },
    {
      label: "OBV",
      weight: 5,
      direction: ind.obvSlope,
      detail: `OBV ${ind.obvSlope === "bullish" ? "por arriba" : ind.obvSlope === "bearish" ? "por debajo" : "en"} su media`,
    },
    {
      label: "Volume Profile (POC)",
      weight: 5,
      direction: ind.volumeProfile.direction,
      detail: `POC en ${ind.volumeProfile.poc.toFixed(0)}`,
    },
    {
      label: "Imbalance del order book",
      weight: 5,
      direction:
        orderBook.imbalanceRatio > 1.1
          ? "bullish"
          : orderBook.imbalanceRatio < 0.9
            ? "bearish"
            : "neutral",
      detail: `Ratio bid/ask: ${orderBook.imbalanceRatio.toFixed(2)}`,
    },
  ];
  return gradeCategory("volumen", "Volumen", checks, 20);
}

function scoreSmartMoney(smcEvents: SmcEvent[], whales: WhaleSummary): CategoryScore {
  // BOS/CHOCH excluded here (moved to Tendencia). Only microstructure remains.
  const microEvents = smcEvents.filter(
    (e) => e.type !== "BOS" && e.type !== "CHOCH"
  );

  const weightByType: Record<string, number> = {
    FVG: 2,
    LIQUIDITY_SWEEP: 4,
    ORDER_BLOCK: 4,
  };

  const checks: ScoreCheck[] = microEvents.map((e) => ({
    label: e.label,
    weight: weightByType[e.type] ?? 2,
    direction: e.direction,
    detail: e.detail,
  }));

  if (whales.tradeCount > 0) {
    checks.push({
      label: "Actividad de ballenas",
      weight: 4,
      direction: whales.netDirection,
      detail: `${whales.tradeCount} operaciones grandes en ${whales.windowMinutes}min`,
    });
  }

  return gradeCategory("smart_money", "Smart Money (microestructura)", checks, 10);
}

function scoreSentimiento(fearGreed: FearGreed | null): CategoryScore {
  if (!fearGreed) return gradeCategory("sentimiento", "Sentimiento (Fear & Greed)", [], 10);
  const { value } = fearGreed;
  let direction: Direction = "neutral";
  let weight = 0;

  if (value <= 25) {
    direction = "bullish";
    weight = 5 + ((25 - value) / 25) * 5;
  } else if (value <= 45) {
    direction = "bullish";
    weight = 2 + ((45 - value) / 20) * 3;
  } else if (value >= 75) {
    direction = "bearish";
    weight = 5 + ((value - 75) / 25) * 5;
  } else if (value >= 55) {
    direction = "bearish";
    weight = 2 + ((value - 55) / 20) * 3;
  }

  const checks: ScoreCheck[] =
    direction === "neutral"
      ? [{ label: "Fear & Greed Index", weight: 1, direction: "neutral", detail: `${value}/100 — ${fearGreed.classification} (neutral)` }]
      : [{ label: "Fear & Greed Index", weight: Math.round(weight * 10) / 10, direction, detail: `${value}/100 — ${fearGreed.classification}` }];

  return gradeCategory("sentimiento", "Sentimiento (Fear & Greed)", checks, 10);
}

function scoreDerivados(deriv: DerivativesSnapshot, candles: Candle[]): CategoryScore {
  const checks: ScoreCheck[] = [];

  if (deriv.fundingRate !== null) {
    let dir: Direction = "neutral";
    // Per-hour thresholds (after the fix using PI_XBTUSD per-second × 3600)
    if (deriv.fundingRate > 0.0005) dir = "bearish";   // > 0.05%/h = longs cargados
    else if (deriv.fundingRate < -0.0003) dir = "bullish"; // < -0.03%/h = shorts cargados
    checks.push({
      label: "Funding rate",
      weight: 4,
      direction: dir,
      detail: `${(deriv.fundingRate * 100).toFixed(4)}%/h`,
    });
  }

  if (deriv.openInterestChangePct !== null && candles.length >= 9) {
    const priceNow = candles[candles.length - 1].close;
    const priceBefore = candles[candles.length - 9].close;
    const priceUp = priceNow > priceBefore;
    const oiUp = deriv.openInterestChangePct > 0;
    let dir: Direction;
    let note: string;
    if (priceUp && oiUp) { dir = "bullish"; note = "Precio y OI suben — tendencia confirmada"; }
    else if (!priceUp && oiUp) { dir = "bearish"; note = "Precio baja con OI subiendo — nuevas posiciones cortas"; }
    else if (priceUp && !oiUp) { dir = "bearish"; note = "Precio sube con OI cayendo — rally débil"; }
    else { dir = "bullish"; note = "Precio y OI bajan — caída débil"; }
    checks.push({ label: "Open Interest vs Precio", weight: 3, direction: dir, detail: note });
  }

  if (deriv.longShortRatio !== null) {
    checks.push({
      label: "Long/Short Ratio",
      weight: 3,
      direction: deriv.longShortRatio > 1.5 ? "bearish" : deriv.longShortRatio < 0.67 ? "bullish" : "neutral",
      detail: `${deriv.longShortRatio.toFixed(2)} cuentas largas por corta`,
    });
  }

  return gradeCategory("derivados", "Derivados", checks, 10);
}

function scoreNoticias(news: NewsHeadline[]): CategoryScore {
  const now = Date.now();
  const checks: ScoreCheck[] = news.map((n) => {
    const ageHours = Math.max(0.5, (now - n.publishedAt) / 3_600_000);
    const recencyWeight = Math.max(0.5, 4 - Math.log2(ageHours + 1));
    return { label: n.title.slice(0, 60), weight: recencyWeight, direction: n.sentiment, detail: `${n.source} — ${n.sentiment}` };
  });
  return gradeCategory("noticias", "Noticias", checks, 10);
}

export function computeMaestroScore(args: {
  indicators: IndicatorSnapshot;
  candles: Candle[];
  orderBook: { imbalanceRatio: number };
  smcEvents: SmcEvent[];
  whales: WhaleSummary;
  derivatives: DerivativesSnapshot;
  fearGreed: FearGreed | null;
  news: NewsHeadline[];
}): MaestroScore {
  const lastCandle = args.candles[args.candles.length - 1];
  const lastCandleUp = lastCandle.close >= lastCandle.open;

  // FIX #7: detect regime before scoring
  const regime = detectRegime(args.indicators, args.candles);

  const categories: CategoryScore[] = [
    scoreTendencia(args.indicators, args.smcEvents),
    scoreMomentum(args.indicators),
    scoreVolumen(args.indicators, lastCandleUp, args.orderBook),
    scoreSmartMoney(args.smcEvents, args.whales),
    scoreSentimiento(args.fearGreed),
    scoreDerivados(args.derivatives, args.candles),
    scoreNoticias(args.news),
  ];

  const bullTotal = categories
    .filter((c) => c.direction === "bullish")
    .reduce((s, c) => s + c.points, 0);
  const bearTotal = categories
    .filter((c) => c.direction === "bearish")
    .reduce((s, c) => s + c.points, 0);

  const direction: Direction =
    bullTotal > bearTotal ? "bullish" : bearTotal > bullTotal ? "bearish" : "neutral";

  let total = categories
    .filter((c) => c.direction === direction)
    .reduce((s, c) => s + c.points, 0);

  // FIX #7: ranging market penalty — halve the score and block signals
  if (regime === "ranging") {
    total = total * 0.5;
  }

  // Breakout bonus — 20% uplift when a confirmed emerging trend is detected
  if (
    (regime === "breakout_up" && direction === "bullish") ||
    (regime === "breakout_down" && direction === "bearish")
  ) {
    total = Math.min(100, total * 1.2);
  }

  let verdict: Verdict = "NO_OPERAR";
  if (direction !== "neutral" && total >= THRESHOLD && regime !== "ranging") {
    verdict = direction === "bullish" ? "COMPRAR" : "VENDER";
  }

  let stopLoss: number | null = null;
  let takeProfit1: number | null = null;
  let takeProfit2: number | null = null;
  let takeProfit3: number | null = null;
  let riskRewardT1: number | null = null;

  if (verdict !== "NO_OPERAR") {
    const price = args.indicators.price;
    const risk = Math.max(args.indicators.atr14 * 1.5, price * 0.003);
    const sign = verdict === "COMPRAR" ? 1 : -1;
    stopLoss = price - sign * risk;
    takeProfit1 = price + sign * risk * 1.5;
    takeProfit2 = price + sign * risk * 2.5;
    takeProfit3 = price + sign * risk * 4;
    riskRewardT1 = 1.5;
  }

  return {
    verdict,
    direction,
    total,
    threshold: THRESHOLD,
    categories,
    stopLoss,
    takeProfit1,
    takeProfit2,
    takeProfit3,
    riskRewardT1,
  };
}

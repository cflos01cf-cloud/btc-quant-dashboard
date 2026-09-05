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

const THRESHOLD = 75;

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

type Regime = "trending_up" | "trending_down" | "ranging" | "breakout_up" | "breakout_down";

function detectRegime(ind: IndicatorSnapshot, candles: Candle[]): Regime {
  const last = candles[candles.length - 1];
  const prev = candles[Math.max(0, candles.length - 5)];
  const bandWidth = ind.bbUpper - ind.bbLower;
  const noTrend = ind.adx14 < 15;
  const priceMove = (last.close - prev.close) / prev.close;
  const prevBandWidth = (ind.bbUpper - ind.bbLower) / ind.bbMid;

  if (noTrend) return "ranging";

  if (!noTrend) {
    if (priceMove > 0.01 && prevBandWidth > 0.015) return "breakout_up";
    if (priceMove < -0.01 && prevBandWidth > 0.015) return "breakout_down";
    return ind.diPlus > ind.diMinus ? "trending_up" : "trending_down";
  }

  return "ranging";
}

function scoreTendencia(ind: IndicatorSnapshot, smcEvents: SmcEvent[]): CategoryScore {
  /**
   * FIX 1 — ADX+DI: when ADX < 15, vote in the direction of the dominant DI
   * with reduced weight (2 instead of 5) instead of neutral.
   * Previously: neutral when ADX < 20 → lost 5 pts even with clear DI direction.
   * Now: always votes, just with less conviction when trend is weak.
   */
  let adxDirection: Direction;
  let adxWeight: number;
  if (ind.adx14 >= 20) {
    adxDirection = ind.diPlus > ind.diMinus ? "bullish" : "bearish";
    adxWeight = 5;
  } else if (ind.adx14 >= 15) {
    adxDirection = ind.diPlus > ind.diMinus ? "bullish" : "bearish";
    adxWeight = 3;
  } else {
    // ADX < 15: very weak trend, vote DI direction with minimal weight
    adxDirection = ind.diPlus > ind.diMinus ? "bullish" : "bearish";
    adxWeight = 2;
  }

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
      weight: adxWeight,
      direction: adxDirection,
      detail: `ADX ${ind.adx14.toFixed(1)} · DI+ ${ind.diPlus.toFixed(1)} / DI- ${ind.diMinus.toFixed(1)}`,
    },
    {
      label: "Supertrend",
      weight: 5,
      direction: ind.supertrendDirection,
      detail: `Supertrend en ${ind.supertrendValue.toFixed(0)} (${ind.supertrendDirection})`,
    },
  ];

  const bosChoch = smcEvents.filter((e) => e.type === "BOS" || e.type === "CHOCH");
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
  /**
   * FIX 2 — StochRSI neutral: when StochRSI is in middle zone (not overbought/oversold),
   * use MACD direction as tiebreaker instead of voting neutral.
   * Previously: neutral when K not crossing D in OB/OS zone → lost 4 pts.
   * Now: votes MACD direction with weight 2 when neutral (less conviction).
   */
  let stochDir: Direction;
  let stochWeight: number;
  const stochInExtreme = ind.stochRsiK > 80 || ind.stochRsiK < 20;
  if (ind.stochRsiK > ind.stochRsiD && ind.stochRsiK < 80) {
    stochDir = "bullish";
    stochWeight = 4;
  } else if (ind.stochRsiK < ind.stochRsiD && ind.stochRsiK > 20) {
    stochDir = "bearish";
    stochWeight = 4;
  } else {
    // Neutral zone — use MACD as tiebreaker with reduced weight
    stochDir = ind.macd > ind.macdSignal ? "bullish" : "bearish";
    stochWeight = 2;
  }

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
      weight: stochWeight,
      direction: stochDir,
      detail: `%K ${ind.stochRsiK.toFixed(0)} / %D ${ind.stochRsiD.toFixed(0)}${stochInExtreme ? "" : " (MACD tiebreaker)"}`,
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
    ? lastCandleUp ? "bullish" : "bearish"
    : ind.obvSlope;

  /**
   * FIX 3 — Order book neutral: when imbalance ratio is between 0.9-1.1 (neutral),
   * use OBV slope as tiebreaker instead of voting neutral.
   * Previously: neutral when ratio 0.9-1.1 → lost 5 pts.
   * Now: votes OBV direction with weight 3 when neutral (less conviction).
   */
  let obDir: Direction;
  let obWeight: number;
  if (orderBook.imbalanceRatio > 1.1) {
    obDir = "bullish";
    obWeight = 5;
  } else if (orderBook.imbalanceRatio < 0.9) {
    obDir = "bearish";
    obWeight = 5;
  } else {
    // Neutral order book — use OBV as tiebreaker
    obDir = ind.obvSlope;
    obWeight = 3;
  }

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
      weight: obWeight,
      direction: obDir,
      detail: `Ratio bid/ask: ${orderBook.imbalanceRatio.toFixed(2)}${obWeight < 5 ? " (OBV tiebreaker)" : ""}`,
    },
  ];
  return gradeCategory("volumen", "Volumen", checks, 20);
}

function scoreSmartMoney(smcEvents: SmcEvent[], whales: WhaleSummary): CategoryScore {
  const microEvents = smcEvents.filter((e) => e.type !== "BOS" && e.type !== "CHOCH");

  /**
   * FIX 4 — Equalize Smart Money weights: previously OBs weighed 4 and FVGs weighed 2,
   * causing 2 bearish OBs (8 pts) to always override 2 bullish FVGs (4 pts).
   * Now all microstructure events weigh 3 each for fair competition.
   */
  const checks: ScoreCheck[] = microEvents.map((e) => ({
    label: e.label,
    weight: 3,
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
  if (!fearGreed) return gradeCategory("sentimiento", "Sentimiento (Fear & Greed)", [], 5);
  const { value } = fearGreed;
  let direction: Direction = "neutral";
  let weight = 0;

  if (value <= 25) {
    direction = "bullish";
    weight = 3 + ((25 - value) / 25) * 2;
  } else if (value >= 75) {
    direction = "bearish";
    weight = 3 + ((value - 75) / 25) * 2;
  }

  const checks: ScoreCheck[] =
    direction === "neutral"
      ? [{ label: "Fear & Greed Index", weight: 1, direction: "neutral", detail: `${value}/100 — ${fearGreed.classification} (zona neutral)` }]
      : [{ label: "Fear & Greed Index", weight: Math.round(weight * 10) / 10, direction, detail: `${value}/100 — ${fearGreed.classification} (extremo contrario)` }];

  return gradeCategory("sentimiento", "Sentimiento (Fear & Greed)", checks, 5);
}

function scoreDerivados(deriv: DerivativesSnapshot, candles: Candle[]): CategoryScore {
  const checks: ScoreCheck[] = [];

  if (deriv.fundingRate !== null) {
    let dir: Direction = "neutral";
    if (deriv.fundingRate > 0.0005) dir = "bearish";
    else if (deriv.fundingRate < -0.0003) dir = "bullish";
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

  return gradeCategory("derivados", "Derivados", checks, 15);
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

  // Regime adjustments
  if (regime === "ranging") {
    total = total * 0.8;
  }
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

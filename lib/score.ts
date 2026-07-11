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

function gradeCategory(id: string, label: string, checks: ScoreCheck[], max: number): CategoryScore {
  if (checks.length === 0) {
    return { id, label, points: 0, max, direction: "neutral", checks: [] };
  }
  const totalWeight = checks.reduce((s, c) => s + c.weight, 0) || 1;
  const bull = checks.filter((c) => c.direction === "bullish").reduce((s, c) => s + c.weight, 0);
  const bear = checks.filter((c) => c.direction === "bearish").reduce((s, c) => s + c.weight, 0);
  const direction: Direction = bull > bear ? "bullish" : bear > bull ? "bearish" : "neutral";
  const alignedWeight = direction === "bullish" ? bull : direction === "bearish" ? bear : 0;
  const points = max * (alignedWeight / totalWeight);
  return { id, label, points, max, direction, checks };
}

function scoreTendencia(ind: IndicatorSnapshot): CategoryScore {
  const checks: ScoreCheck[] = [
    {
      label: "Precio vs EMA200",
      weight: 5,
      direction: ind.price > ind.ema200 ? "bullish" : "bearish",
      detail: `Precio ${ind.price > ind.ema200 ? "sobre" : "bajo"} EMA200 (${ind.ema200.toFixed(0)})`,
    },
    {
      label: "Cruce EMA50/EMA200",
      weight: 5,
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
  return gradeCategory("tendencia", "Tendencia", checks, 20);
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
  // Lowered from 1.2x to 1.05x: with 1h candles volume is far more stable
  // than on 15m, so the old 20% threshold almost never fired, leaving this
  // category permanently neutral. 5% above average is a meaningful
  // confirmation on a 1h timeframe.
  const volAboveAvg = ind.lastVolume > ind.avgVolume20 * 1.05;
  const volDir: Direction = volAboveAvg
    ? lastCandleUp ? "bullish" : "bearish"
    : ind.obvSlope; // when volume is flat, defer to OBV slope for direction
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
      detail: `OBV ${ind.obvSlope === "bullish" ? "por arriba" : ind.obvSlope === "bearish" ? "por debajo" : "en"} su media de 10`,
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
        orderBook.imbalanceRatio > 1.1 ? "bullish" : orderBook.imbalanceRatio < 0.9 ? "bearish" : "neutral",
      detail: `Ratio bid/ask: ${orderBook.imbalanceRatio.toFixed(2)}`,
    },
  ];
  return gradeCategory("volumen", "Volumen", checks, 15);
}

function scoreSmartMoney(smcEvents: SmcEvent[], whales: WhaleSummary): CategoryScore {
  const weightByType: Record<SmcEvent["type"], number> = {
    BOS: 6,
    CHOCH: 6,
    FVG: 2,
    LIQUIDITY_SWEEP: 4,
    ORDER_BLOCK: 4,
  };
  const checks: ScoreCheck[] = smcEvents.map((e) => ({
    label: e.label,
    weight: weightByType[e.type],
    direction: e.direction,
    detail: e.detail,
  }));
  if (whales.tradeCount > 0) {
    checks.push({
      label: "Actividad de ballenas",
      weight: 2,
      direction: whales.netDirection,
      detail: `${whales.tradeCount} operaciones grandes en ${whales.windowMinutes}min — ${whales.buyVolume.toFixed(1)} BTC compra vs ${whales.sellVolume.toFixed(1)} BTC venta`,
    });
  }
  return gradeCategory("smart_money", "Smart Money (heurístico)", checks, 20);
}

function scoreSentimiento(fearGreed: FearGreed | null): CategoryScore {
  if (!fearGreed) return gradeCategory("sentimiento", "Sentimiento (Fear & Greed)", [], 10);
  const { value } = fearGreed;

  // Contrarian scale across the full range (not just extremes):
  // 0-25  Extreme Fear  → strongly bullish (contrarian buy zone)
  // 26-45 Fear          → mildly bullish
  // 46-54 Neutral       → neutral (no vote)
  // 55-74 Greed         → mildly bearish
  // 75-100 Extreme Greed → strongly bearish (contrarian sell zone)
  let direction: Direction = "neutral";
  let weight = 0;

  if (value <= 25) {
    direction = "bullish";
    weight = 5 + ((25 - value) / 25) * 5; // 5-10 depending on how extreme
  } else if (value <= 45) {
    direction = "bullish";
    weight = 2 + ((45 - value) / 20) * 3; // 2-5
  } else if (value >= 75) {
    direction = "bearish";
    weight = 5 + ((value - 75) / 25) * 5; // 5-10
  } else if (value >= 55) {
    direction = "bearish";
    weight = 2 + ((value - 55) / 20) * 3; // 2-5
  }
  // 46-54 stays neutral with weight 0

  const checks: ScoreCheck[] = direction === "neutral"
    ? [{
        label: "Fear & Greed Index",
        weight: 1,
        direction: "neutral",
        detail: `${value}/100 — ${fearGreed.classification} (zona neutral, sin voto)`,
      }]
    : [{
        label: "Fear & Greed Index",
        weight: Math.round(weight * 10) / 10,
        direction,
        detail: `${value}/100 — ${fearGreed.classification}`,
      }];

  return gradeCategory("sentimiento", "Sentimiento (Fear & Greed)", checks, 10);
}

function scoreDerivados(deriv: DerivativesSnapshot, candles: Candle[]): CategoryScore {
  const checks: ScoreCheck[] = [];

  if (deriv.fundingRate !== null) {
    let dir: Direction = "neutral";
    if (deriv.fundingRate > 0.0005) dir = "bearish"; // crowded longs, contrarian risk
    else if (deriv.fundingRate < -0.0003) dir = "bullish"; // crowded shorts, squeeze risk
    checks.push({
      label: "Funding rate",
      weight: 4,
      direction: dir,
      detail: `${(deriv.fundingRate * 100).toFixed(4)}% por periodo`,
    });
  }

  if (deriv.openInterestChangePct !== null && candles.length >= 9) {
    const priceNow = candles[candles.length - 1].close;
    const priceBefore = candles[candles.length - 9].close;
    const priceUp = priceNow > priceBefore;
    const oiUp = deriv.openInterestChangePct > 0;
    let dir: Direction;
    let note: string;
    if (priceUp && oiUp) {
      dir = "bullish";
      note = "Precio y OI suben — tendencia confirmada con nuevas posiciones";
    } else if (!priceUp && oiUp) {
      dir = "bearish";
      note = "Precio baja con OI subiendo — nuevas posiciones cortas";
    } else if (priceUp && !oiUp) {
      dir = "bearish";
      note = "Precio sube con OI cayendo — posible cobertura de cortos, rally débil";
    } else {
      dir = "bullish";
      note = "Precio y OI bajan — posible cierre de largos, caída débil";
    }
    checks.push({
      label: "Open Interest vs Precio",
      weight: 3,
      direction: dir,
      detail: `${note} (OI ${deriv.openInterestChangePct >= 0 ? "+" : ""}${deriv.openInterestChangePct.toFixed(1)}%)`,
    });
  }

  if (deriv.longShortRatio !== null) {
    let dir: Direction = "neutral";
    if (deriv.longShortRatio > 1.5) dir = "bearish";
    else if (deriv.longShortRatio < 0.67) dir = "bullish";
    checks.push({
      label: "Long/Short Ratio",
      weight: 3,
      direction: dir,
      detail: `${deriv.longShortRatio.toFixed(2)} cuentas largas por cada corta`,
    });
  }

  return gradeCategory("derivados", "Derivados", checks, 10);
}

function scoreNoticias(news: NewsHeadline[]): CategoryScore {
  const now = Date.now();
  const checks: ScoreCheck[] = news.map((n) => {
    const ageHours = Math.max(0.5, (now - n.publishedAt) / 3_600_000);
    const recencyWeight = Math.max(0.5, 4 - Math.log2(ageHours + 1));
    return {
      label: n.title.slice(0, 60),
      weight: recencyWeight,
      direction: n.sentiment,
      detail: `${n.source} — ${n.sentiment}`,
    };
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

  const categories: CategoryScore[] = [
    scoreTendencia(args.indicators),
    scoreMomentum(args.indicators),
    scoreVolumen(args.indicators, lastCandleUp, args.orderBook),
    scoreSmartMoney(args.smcEvents, args.whales),
    scoreSentimiento(args.fearGreed),
    scoreDerivados(args.derivatives, args.candles),
    scoreNoticias(args.news),
  ];

  const bullTotal = categories.filter((c) => c.direction === "bullish").reduce((s, c) => s + c.points, 0);
  const bearTotal = categories.filter((c) => c.direction === "bearish").reduce((s, c) => s + c.points, 0);
  const direction: Direction = bullTotal > bearTotal ? "bullish" : bearTotal > bullTotal ? "bearish" : "neutral";
  const total = direction === "neutral" ? 0 : categories.filter((c) => c.direction === direction).reduce((s, c) => s + c.points, 0);

  let verdict: Verdict = "NO_OPERAR";
  if (direction !== "neutral" && total >= THRESHOLD) {
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

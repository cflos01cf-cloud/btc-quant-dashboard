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

/**
 * MODELO DE CONVICCIÓN (v3)
 *
 * Problema del modelo anterior: el score sumaba los puntos de las categorías
 * alineadas contra un denominador fijo de 100. Las categorías que votaban
 * neutral aportaban 0 pero seguían ocupando su cuota del total, creando un
 * techo invisible:
 *
 *   Noticias:    3-4 / 10 crónicamente (titulares siempre mixtos)
 *   Sentimiento: 0 / 5 casi siempre (solo vota en extremos ≤25 / ≥75)
 *   Derivados:   0 o 15, binario
 *
 * Eso drena ~11-26 pts de forma estructural. El máximo realista era ~85-89,
 * no 100. Pedir 75/100 equivalía a exigir el 84-88% del máximo alcanzable —
 * necesitaba que absolutamente todo se alineara al mismo tiempo.
 *
 * Modelo nuevo — dos puertas independientes:
 *
 *   MAGNITUD   = puntos alineados en la dirección ganadora (escala absoluta)
 *                → ¿hay suficiente evidencia?
 *
 *   CONVICCIÓN = alineados / (alineados + opuestos) × 100
 *                → ¿la evidencia que SÍ votó, está de acuerdo?
 *
 * Las categorías neutrales ya no penalizan: quedan fuera del denominador.
 * Una señal requiere AMBAS puertas. Esto mantiene el filtro contra mercados
 * divididos (que es lo que queremos evitar) sin castigar los casos donde
 * la evidencia disponible es clara pero algunas fuentes están calladas.
 *
 * El campo `total` que se publica al dashboard y a Supabase sigue siendo la
 * magnitud, para que los registros históricos sigan siendo comparables.
 */

// Puerta 1: evidencia mínima en la dirección ganadora
const MIN_MAGNITUD = 45;

// Puerta 2: porcentaje mínimo de acuerdo entre las categorías que votaron
const MIN_CONVICCION = 75;

// Se mantiene por compatibilidad con el payload / UI existente
const THRESHOLD = MIN_MAGNITUD;

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
  const noTrend = ind.adx14 < 15;
  const priceMove = (last.close - prev.close) / prev.close;
  const bandWidthPct = (ind.bbUpper - ind.bbLower) / ind.bbMid;

  if (noTrend) return "ranging";

  if (priceMove > 0.01 && bandWidthPct > 0.015) return "breakout_up";
  if (priceMove < -0.01 && bandWidthPct > 0.015) return "breakout_down";
  return ind.diPlus > ind.diMinus ? "trending_up" : "trending_down";
}

function scoreTendencia(ind: IndicatorSnapshot, smcEvents: SmcEvent[]): CategoryScore {
  let adxWeight: number;
  if (ind.adx14 >= 20) adxWeight = 5;
  else if (ind.adx14 >= 15) adxWeight = 3;
  else adxWeight = 2;
  const adxDirection: Direction = ind.diPlus > ind.diMinus ? "bullish" : "bearish";

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
    stochDir = ind.macd > ind.macdSignal ? "bullish" : "bearish";
    stochWeight = 2;
  }

  // RSI: en zona media usa la pendiente del MACD como desempate en vez de
  // votar neutral — mismo criterio aplicado a StochRSI y order book.
  let rsiDir: Direction;
  let rsiWeight: number;
  if (ind.rsi14 > 55) {
    rsiDir = "bullish";
    rsiWeight = 4;
  } else if (ind.rsi14 < 45) {
    rsiDir = "bearish";
    rsiWeight = 4;
  } else {
    rsiDir = ind.macdHist >= 0 ? "bullish" : "bearish";
    rsiWeight = 2;
  }

  const checks: ScoreCheck[] = [
    {
      label: "RSI(14)",
      weight: rsiWeight,
      direction: rsiDir,
      detail: `RSI ${ind.rsi14.toFixed(1)}${rsiWeight < 4 ? " (zona media, desempate MACD)" : ""}`,
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
      detail: `%K ${ind.stochRsiK.toFixed(0)} / %D ${ind.stochRsiD.toFixed(0)}${stochInExtreme ? "" : " (desempate MACD)"}`,
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

  let obDir: Direction;
  let obWeight: number;
  if (orderBook.imbalanceRatio > 1.1) {
    obDir = "bullish";
    obWeight = 5;
  } else if (orderBook.imbalanceRatio < 0.9) {
    obDir = "bearish";
    obWeight = 5;
  } else {
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
      detail: `Ratio bid/ask: ${orderBook.imbalanceRatio.toFixed(2)}${obWeight < 5 ? " (desempate OBV)" : ""}`,
    },
  ];
  return gradeCategory("volumen", "Volumen", checks, 20);
}

function scoreSmartMoney(smcEvents: SmcEvent[], whales: WhaleSummary): CategoryScore {
  const microEvents = smcEvents.filter((e) => e.type !== "BOS" && e.type !== "CHOCH");

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
    if (deriv.fundingRate > 0.0000003) dir = "bearish";
    else if (deriv.fundingRate < -0.0000003) dir = "bullish";
    checks.push({
      label: "Funding rate",
      weight: 4,
      direction: dir,
      detail: `${(deriv.fundingRate * 3600 * 100).toFixed(4)}%/h`,
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

  // MAGNITUD: puntos alineados en la dirección ganadora
  let magnitud = direction === "bullish" ? bullTotal : direction === "bearish" ? bearTotal : 0;
  const opuestos = direction === "bullish" ? bearTotal : direction === "bearish" ? bullTotal : 0;

  // Ajuste de régimen sobre la magnitud (no sobre la convicción: el consenso
  // entre categorías no cambia porque el mercado esté lateral)
  if (regime === "ranging") {
    magnitud = magnitud * 0.8;
  }
  if (
    (regime === "breakout_up" && direction === "bullish") ||
    (regime === "breakout_down" && direction === "bearish")
  ) {
    magnitud = Math.min(100, magnitud * 1.2);
  }

  // CONVICCIÓN: las categorías neutrales quedan fuera del denominador
  const votaron = magnitud + opuestos;
  const conviccion = votaron > 0 ? (magnitud / votaron) * 100 : 0;

  // Las dos puertas deben cumplirse simultáneamente
  let verdict: Verdict = "NO_OPERAR";
  if (
    direction !== "neutral" &&
    regime !== "ranging" &&
    magnitud >= MIN_MAGNITUD &&
    conviccion >= MIN_CONVICCION
  ) {
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
    total: magnitud,
    threshold: THRESHOLD,
    categories,
    stopLoss,
    takeProfit1,
    takeProfit2,
    takeProfit3,
    riskRewardT1,
    conviccion,
    magnitud,
    regimen: regime,
    minMagnitud: MIN_MAGNITUD,
    minConviccion: MIN_CONVICCION,
  };
}

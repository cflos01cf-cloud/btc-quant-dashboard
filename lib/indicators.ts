import { Candle, Direction, IndicatorSnapshot } from "./types";

/**
 * All series-producing functions return arrays aligned 1:1 with the input
 * candles. Every series is guarded against NaN by falling back to the
 * previous valid value instead of propagating NaN forward (root cause of
 * the "VWAP NaN on forex feeds" bug from the EUR/USD dashboard).
 */

export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0];
  values.forEach((v, i) => {
    const val = Number.isFinite(v) ? v : prev;
    const next = i === 0 ? val : val * k + prev * (1 - k);
    out.push(next);
    prev = next;
  });
  return out;
}

export function sma(values: number[], period: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    const denom = Math.min(i + 1, period);
    out.push(sum / denom);
  }
  return out;
}

export function rsi(closes: number[], period = 14): number[] {
  const out: number[] = [50];
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (i <= period) {
      avgGain = (avgGain * (i - 1) + gain) / i;
      avgLoss = (avgLoss * (i - 1) + loss) / i;
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return out;
}

export function stochasticRsi(rsiSeries: number[], period = 14, smoothK = 3, smoothD = 3) {
  const rawK: number[] = rsiSeries.map((_, i) => {
    const start = Math.max(0, i - period + 1);
    const window = rsiSeries.slice(start, i + 1);
    const lo = Math.min(...window);
    const hi = Math.max(...window);
    return hi - lo === 0 ? 50 : ((rsiSeries[i] - lo) / (hi - lo)) * 100;
  });
  const k = sma(rawK, smoothK);
  const d = sma(k, smoothD);
  return { k, d };
}

export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = ema(macdLine, signalPeriod);
  const hist = macdLine.map((v, i) => v - signalLine[i]);
  return { macdLine, signalLine, hist };
}

export function bollinger(closes: number[], period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const start = Math.max(0, i - period + 1);
    const window = closes.slice(start, i + 1);
    const mean = mid[i];
    const variance = window.reduce((acc, v) => acc + (v - mean) ** 2, 0) / window.length;
    const sd = Math.sqrt(variance);
    upper.push(mean + mult * sd);
    lower.push(mean - mult * sd);
  }
  return { mid, upper, lower };
}

export function atr(candles: Candle[], period = 14): number[] {
  const trs: number[] = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
  const out: number[] = [];
  let prev = trs[0];
  trs.forEach((tr, i) => {
    const next = i === 0 ? tr : (prev * (period - 1) + tr) / period;
    out.push(next);
    prev = next;
  });
  return out;
}

/** Rolling VWAP over the supplied candle window (not a calendar-session VWAP). */
export function vwapSeries(candles: Candle[]): number[] {
  const out: number[] = [];
  let cumPV = 0;
  let cumVol = 0;
  candles.forEach((c) => {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumPV += typicalPrice * c.volume;
    cumVol += c.volume;
    out.push(cumVol > 0 ? cumPV / cumVol : c.close);
  });
  return out;
}

/** ADX(14) with +DI/-DI, Wilder smoothing. */
export function adx(candles: Candle[], period = 14) {
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  const tr: number[] = [candles[0].high - candles[0].low];

  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(
      Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      )
    );
  }

  const wilderSmooth = (arr: number[]) => {
    const out: number[] = [];
    let prev = arr[0];
    arr.forEach((v, i) => {
      const next = i === 0 ? v : prev - prev / period + v;
      out.push(next);
      prev = next;
    });
    return out;
  };

  const smoothTR = wilderSmooth(tr);
  const smoothPlusDM = wilderSmooth(plusDM);
  const smoothMinusDM = wilderSmooth(minusDM);

  const diPlus = smoothPlusDM.map((v, i) => (smoothTR[i] > 0 ? (v / smoothTR[i]) * 100 : 0));
  const diMinus = smoothMinusDM.map((v, i) => (smoothTR[i] > 0 ? (v / smoothTR[i]) * 100 : 0));
  const dx = diPlus.map((v, i) => {
    const sum = v + diMinus[i];
    return sum > 0 ? (Math.abs(v - diMinus[i]) / sum) * 100 : 0;
  });

  // ADX = Wilder-smoothed DX
  const adxSeries: number[] = [];
  let prevAdx = dx[0];
  dx.forEach((v, i) => {
    const next = i === 0 ? v : (prevAdx * (period - 1) + v) / period;
    adxSeries.push(next);
    prevAdx = next;
  });

  return { adx: adxSeries, diPlus, diMinus };
}

/** OBV (On Balance Volume). */
export function obv(candles: Candle[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const sign = Math.sign(candles[i].close - candles[i - 1].close);
    out.push(out[i - 1] + sign * candles[i].volume);
  }
  return out;
}

/** Supertrend(period, multiplier). Returns value series + direction series. */
export function supertrend(candles: Candle[], period = 10, mult = 3) {
  const atrSeries = atr(candles, period);
  const upperBasic: number[] = [];
  const lowerBasic: number[] = [];
  candles.forEach((c, i) => {
    const mid = (c.high + c.low) / 2;
    upperBasic.push(mid + mult * atrSeries[i]);
    lowerBasic.push(mid - mult * atrSeries[i]);
  });

  const finalUpper: number[] = [upperBasic[0]];
  const finalLower: number[] = [lowerBasic[0]];
  const trendDir: Direction[] = ["bullish"];
  const value: number[] = [lowerBasic[0]];

  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].close;
    finalUpper.push(
      upperBasic[i] < finalUpper[i - 1] || prevClose > finalUpper[i - 1]
        ? upperBasic[i]
        : finalUpper[i - 1]
    );
    finalLower.push(
      lowerBasic[i] > finalLower[i - 1] || prevClose < finalLower[i - 1]
        ? lowerBasic[i]
        : finalLower[i - 1]
    );

    const close = candles[i].close;
    let dir: Direction = trendDir[i - 1];
    if (dir === "bullish" && close < finalLower[i]) dir = "bearish";
    else if (dir === "bearish" && close > finalUpper[i]) dir = "bullish";
    trendDir.push(dir);
    value.push(dir === "bullish" ? finalLower[i] : finalUpper[i]);
  }

  return { value, direction: trendDir };
}

/** Parabolic SAR (standard Wilder algorithm). */
export function parabolicSar(candles: Candle[], step = 0.02, max = 0.2) {
  const sar: number[] = [];
  const dir: Direction[] = [];
  let isUp = candles[1] ? candles[1].close > candles[0].close : true;
  let af = step;
  let ep = isUp ? candles[0].high : candles[0].low;
  let prevSar = isUp ? candles[0].low : candles[0].high;

  for (let i = 0; i < candles.length; i++) {
    if (i > 0) {
      prevSar = prevSar + af * (ep - prevSar);
      if (isUp) {
        prevSar = Math.min(prevSar, candles[i - 1].low, candles[i].low);
        if (candles[i].low < prevSar) {
          isUp = false;
          prevSar = ep;
          ep = candles[i].low;
          af = step;
        }
      } else {
        prevSar = Math.max(prevSar, candles[i - 1].high, candles[i].high);
        if (candles[i].high > prevSar) {
          isUp = true;
          prevSar = ep;
          ep = candles[i].high;
          af = step;
        }
      }
      if (isUp && candles[i].high > ep) {
        ep = candles[i].high;
        af = Math.min(af + step, max);
      } else if (!isUp && candles[i].low < ep) {
        ep = candles[i].low;
        af = Math.min(af + step, max);
      }
    }
    sar.push(prevSar);
    dir.push(isUp ? "bullish" : "bearish");
  }
  return { sar, direction: dir };
}

/** Ichimoku — current-value snapshot (Tenkan/Kijun/SpanA/SpanB), no forward shift. */
export function ichimokuSnapshot(candles: Candle[]) {
  const highestLowest = (period: number) => {
    const window = candles.slice(-period);
    const high = Math.max(...window.map((c) => c.high));
    const low = Math.min(...window.map((c) => c.low));
    return { high, low };
  };
  const conv = highestLowest(9);
  const base = highestLowest(26);
  const span = highestLowest(52);
  const tenkan = (conv.high + conv.low) / 2;
  const kijun = (base.high + base.low) / 2;
  const spanA = (tenkan + kijun) / 2;
  const spanB = (span.high + span.low) / 2;
  return { tenkan, kijun, spanA, spanB };
}

/** Simplified Volume Profile: bucket volume by price level, return POC. */
export function volumeProfilePoc(candles: Candle[], bins = 24) {
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const span = max - min || 1;
  const buckets = new Array(bins).fill(0);
  candles.forEach((c) => {
    const typical = (c.high + c.low + c.close) / 3;
    const idx = Math.min(bins - 1, Math.max(0, Math.floor(((typical - min) / span) * bins)));
    buckets[idx] += c.volume;
  });
  const maxIdx = buckets.indexOf(Math.max(...buckets));
  const poc = min + (maxIdx + 0.5) * (span / bins);
  return poc;
}

export function buildIndicatorSnapshot(candles: Candle[]): IndicatorSnapshot {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const last = closes.length - 1;

  const ema9Series = ema(closes, 9);
  const ema20Series = ema(closes, 20);
  const ema50Series = ema(closes, 50);
  const ema100Series = ema(closes, 100);
  const ema200Series = ema(closes, 200);
  const rsiSeries = rsi(closes, 14);
  const stoch = stochasticRsi(rsiSeries, 14, 3, 3);
  const { macdLine, signalLine, hist } = macd(closes);
  const vwap = vwapSeries(candles);
  const bb = bollinger(closes, 20, 2);
  const atrSeries = atr(candles, 14);
  const atrAvg50Series = sma(atrSeries, 50);
  const { adx: adxSeries, diPlus, diMinus } = adx(candles, 14);
  const obvSeries = obv(candles);
  const obvSma = sma(obvSeries, 10);
  const st = supertrend(candles, 10, 3);
  const psar = parabolicSar(candles);
  const ichimoku = ichimokuSnapshot(candles);
  const poc = volumeProfilePoc(candles.slice(-120), 24);
  const volAvg20Series = sma(volumes, 20);

  const obvSlope: Direction =
    obvSeries[last] > obvSma[last] ? "bullish" : obvSeries[last] < obvSma[last] ? "bearish" : "neutral";

  return {
    price: closes[last],
    ema9: ema9Series[last],
    ema20: ema20Series[last],
    ema50: ema50Series[last],
    ema100: ema100Series[last],
    ema200: ema200Series[last],
    rsi14: rsiSeries[last],
    stochRsiK: stoch.k[last],
    stochRsiD: stoch.d[last],
    macd: macdLine[last],
    macdSignal: signalLine[last],
    macdHist: hist[last],
    vwap: vwap[last],
    bbUpper: bb.upper[last],
    bbMid: bb.mid[last],
    bbLower: bb.lower[last],
    atr14: atrSeries[last],
    atr14Avg50: atrAvg50Series[last],
    adx14: adxSeries[last],
    diPlus: diPlus[last],
    diMinus: diMinus[last],
    obv: obvSeries[last],
    obvSlope,
    supertrendValue: st.value[last],
    supertrendDirection: st.direction[last],
    parabolicSar: psar.sar[last],
    parabolicSarDirection: psar.direction[last],
    ichimoku,
    volumeProfile: {
      poc,
      direction: closes[last] > poc ? "bullish" : "bearish",
    },
    avgVolume20: volAvg20Series[last],
    lastVolume: volumes[last],
  };
}

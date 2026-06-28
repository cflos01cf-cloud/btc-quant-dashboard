import { Candle, Direction, SmcEvent } from "./types";
import { atr } from "./indicators";

/**
 * Heuristic Smart Money Concepts detection. This is a simplified, rule-based
 * approximation of ICT/SMC ideas (swing structure, BOS/CHOCH, Fair Value
 * Gaps, liquidity sweeps, order blocks) — not a institutional-grade SMC
 * engine. It's meant to surface plausible zones/events for context, not to
 * be treated as ground truth.
 */

interface Swing {
  index: number;
  price: number;
  type: "high" | "low";
}

function findSwings(candles: Candle[], lookback = 2): Swing[] {
  const swings: Swing[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const windowHighs = candles.slice(i - lookback, i + lookback + 1).map((c) => c.high);
    const windowLows = candles.slice(i - lookback, i + lookback + 1).map((c) => c.low);
    if (candles[i].high === Math.max(...windowHighs)) {
      swings.push({ index: i, price: candles[i].high, type: "high" });
    }
    if (candles[i].low === Math.min(...windowLows)) {
      swings.push({ index: i, price: candles[i].low, type: "low" });
    }
  }
  return swings;
}

function detectBosChoch(candles: Candle[]): SmcEvent[] {
  const events: SmcEvent[] = [];
  const swings = findSwings(candles, 2);
  const highs = swings.filter((s) => s.type === "high");
  const lows = swings.filter((s) => s.type === "low");
  if (highs.length < 2 || lows.length < 2) return events;

  const lastHigh = highs[highs.length - 1];
  const prevHigh = highs[highs.length - 2];
  const lastLow = lows[lows.length - 1];
  const prevLow = lows[lows.length - 2];

  const priorTrendUp = lastHigh.price > prevHigh.price && lastLow.price > prevLow.price;
  const priorTrendDown = lastHigh.price < prevHigh.price && lastLow.price < prevLow.price;

  const close = candles[candles.length - 1].close;
  const referenceHigh = Math.max(lastHigh.price, prevHigh.price);
  const referenceLow = Math.min(lastLow.price, prevLow.price);

  if (close > referenceHigh) {
    events.push({
      type: priorTrendUp ? "BOS" : "CHOCH",
      direction: "bullish",
      label: priorTrendUp ? "BOS alcista (continuación)" : "CHOCH alcista (cambio de carácter)",
      detail: `Cierre (${close.toFixed(0)}) rompió el último máximo relevante (${referenceHigh.toFixed(0)})`,
      price: referenceHigh,
    });
  } else if (close < referenceLow) {
    events.push({
      type: priorTrendDown ? "BOS" : "CHOCH",
      direction: "bearish",
      label: priorTrendDown ? "BOS bajista (continuación)" : "CHOCH bajista (cambio de carácter)",
      detail: `Cierre (${close.toFixed(0)}) rompió el último mínimo relevante (${referenceLow.toFixed(0)})`,
      price: referenceLow,
    });
  }

  return events;
}

function detectFvg(candles: Candle[], lookback = 40): SmcEvent[] {
  const events: SmcEvent[] = [];
  const recent = candles.slice(-lookback);
  const currentPrice = candles[candles.length - 1].close;

  for (let i = 2; i < recent.length; i++) {
    const c1 = recent[i - 2];
    const c3 = recent[i];
    if (c1.high < c3.low) {
      // bullish gap — only report if not yet fully filled by later price action
      const filled = recent.slice(i).some((c) => c.low <= c1.high);
      if (!filled) {
        events.push({
          type: "FVG",
          direction: "bullish",
          label: "Fair Value Gap alcista sin rellenar",
          detail: `Gap entre ${c1.high.toFixed(0)} y ${c3.low.toFixed(0)}`,
          price: (c1.high + c3.low) / 2,
          time: c3.time,
        });
      }
    } else if (c1.low > c3.high) {
      const filled = recent.slice(i).some((c) => c.high >= c1.low);
      if (!filled) {
        events.push({
          type: "FVG",
          direction: "bearish",
          label: "Fair Value Gap bajista sin rellenar",
          detail: `Gap entre ${c3.high.toFixed(0)} y ${c1.low.toFixed(0)}`,
          price: (c1.low + c3.high) / 2,
          time: c3.time,
        });
      }
    }
  }
  // Keep only the most recent bullish + bearish FVG to avoid clutter
  const lastBullish = [...events].reverse().find((e) => e.direction === "bullish");
  const lastBearish = [...events].reverse().find((e) => e.direction === "bearish");
  return [lastBullish, lastBearish].filter((e): e is SmcEvent => Boolean(e));
}

function detectLiquiditySweep(candles: Candle[], lookback = 20): SmcEvent[] {
  const events: SmcEvent[] = [];
  const swings = findSwings(candles.slice(-lookback - 5), 2);
  const recentHighs = swings.filter((s) => s.type === "high").map((s) => s.price);
  const recentLows = swings.filter((s) => s.type === "low").map((s) => s.price);
  const last = candles[candles.length - 1];
  const priorSwingHigh = recentHighs.length ? Math.max(...recentHighs.slice(0, -1)) : null;
  const priorSwingLow = recentLows.length ? Math.min(...recentLows.slice(0, -1)) : null;

  if (priorSwingLow && last.low < priorSwingLow && last.close > priorSwingLow) {
    events.push({
      type: "LIQUIDITY_SWEEP",
      direction: "bullish",
      label: "Barrido de liquidez bajo mínimos",
      detail: `Mecha bajo ${priorSwingLow.toFixed(0)} con cierre de vuelta dentro de rango`,
      price: priorSwingLow,
      time: last.time,
    });
  }
  if (priorSwingHigh && last.high > priorSwingHigh && last.close < priorSwingHigh) {
    events.push({
      type: "LIQUIDITY_SWEEP",
      direction: "bearish",
      label: "Barrido de liquidez sobre máximos",
      detail: `Mecha sobre ${priorSwingHigh.toFixed(0)} con cierre de vuelta dentro de rango`,
      price: priorSwingHigh,
      time: last.time,
    });
  }
  return events;
}

function detectOrderBlocks(candles: Candle[], lookback = 40): SmcEvent[] {
  const events: SmcEvent[] = [];
  const atrSeries = atr(candles, 14);
  const recentStart = Math.max(2, candles.length - lookback);

  for (let i = candles.length - 3; i >= recentStart; i--) {
    const origin = candles[i];
    const impulse = candles.slice(i + 1, i + 4);
    if (impulse.length < 2) continue;
    const moveUp = impulse[impulse.length - 1].close - impulse[0].open;
    const avgAtr = atrSeries[i] || 1;

    if (origin.close < origin.open && moveUp > avgAtr * 1.5) {
      events.push({
        type: "ORDER_BLOCK",
        direction: "bullish",
        label: "Order block alcista",
        detail: `Última vela bajista antes de un impulso de ${(moveUp / avgAtr).toFixed(1)}x ATR`,
        price: origin.low,
        time: origin.time,
      });
      break;
    }
    if (origin.close > origin.open && -moveUp > avgAtr * 1.5) {
      events.push({
        type: "ORDER_BLOCK",
        direction: "bearish",
        label: "Order block bajista",
        detail: `Última vela alcista antes de un impulso de ${(-moveUp / avgAtr).toFixed(1)}x ATR`,
        price: origin.high,
        time: origin.time,
      });
      break;
    }
  }
  return events;
}

export function detectSmcEvents(candles: Candle[]): SmcEvent[] {
  if (candles.length < 60) return [];
  return [
    ...detectBosChoch(candles),
    ...detectFvg(candles),
    ...detectLiquiditySweep(candles),
    ...detectOrderBlocks(candles),
  ];
}

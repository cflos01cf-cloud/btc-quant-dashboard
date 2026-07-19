import { Candle, Direction, SmcEvent } from "./types";

/**
 * FIX #10 — BOS/CHOCH lookback increased from 2 to 5.
 * With lookback=5, a swing high requires being the highest of 11 candles,
 * filtering noise and focusing on structurally significant breakouts.
 */
const SMC_LOOKBACK = 5;

interface Swing {
  candleIndex: number;
  price: number;
  type: "high" | "low";
}

function findSwings(candles: Candle[], lookback = SMC_LOOKBACK): Swing[] {
  const swings: Swing[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const window = candles.slice(i - lookback, i + lookback + 1);
    const isSwingHigh = candles[i].high === Math.max(...window.map((c) => c.high));
    const isSwingLow = candles[i].low === Math.min(...window.map((c) => c.low));
    if (isSwingHigh) swings.push({ candleIndex: i, price: candles[i].high, type: "high" });
    if (isSwingLow) swings.push({ candleIndex: i, price: candles[i].low, type: "low" });
  }
  return swings;
}

function detectBosChoch(candles: Candle[], swings: Swing[]): SmcEvent[] {
  const events: SmcEvent[] = [];
  const highs = swings.filter((s) => s.type === "high");
  const lows = swings.filter((s) => s.type === "low");

  // BOS bullish: price closes above last swing high
  for (let i = 1; i < highs.length; i++) {
    const prevHigh = highs[i - 1];
    const broke = candles.slice(prevHigh.candleIndex + 1).some((c) => c.close > prevHigh.price);
    if (broke) {
      events.push({
        type: "BOS",
        direction: "bullish",
        label: "BOS alcista",
        detail: `Ruptura de estructura sobre ${prevHigh.price.toFixed(0)}`,
        price: prevHigh.price,
      });
    }
  }

  // BOS bearish: price closes below last swing low
  for (let i = 1; i < lows.length; i++) {
    const prevLow = lows[i - 1];
    const broke = candles.slice(prevLow.candleIndex + 1).some((c) => c.close < prevLow.price);
    if (broke) {
      events.push({
        type: "BOS",
        direction: "bearish",
        label: "BOS bajista",
        detail: `Ruptura de estructura bajo ${prevLow.price.toFixed(0)}`,
        price: prevLow.price,
      });
    }
  }

  // CHOCH: reversal of last BOS direction
  const lastBullBos = [...events].reverse().find((e) => e.type === "BOS" && e.direction === "bullish");
  const lastBearBos = [...events].reverse().find((e) => e.type === "BOS" && e.direction === "bearish");

  if (lastBullBos && lastBearBos) {
    // Find which one appeared later in the events array
    const bullIdx = events.lastIndexOf(lastBullBos);
    const bearIdx = events.lastIndexOf(lastBearBos);
    if (bearIdx > bullIdx) {
      events.push({
        type: "CHOCH",
        direction: "bullish",
        label: "CHOCH — cambio de carácter alcista",
        detail: "Posible reversión de tendencia bajista",
        price: lastBearBos.price,
      });
    }
  }

  return events.slice(-5);
}

function detectFVG(candles: Candle[]): SmcEvent[] {
  const events: SmcEvent[] = [];
  for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2];
    const c3 = candles[i];
    const minGap = candles[i - 1].close * 0.001;

    if (c3.low > c1.high && c3.low - c1.high > minGap) {
      events.push({
        type: "FVG",
        direction: "bullish",
        label: "FVG alcista",
        detail: `Vacío de valor justo en ${c1.high.toFixed(0)}-${c3.low.toFixed(0)}`,
        price: (c1.high + c3.low) / 2,
      });
    }
    if (c1.low > c3.high && c1.low - c3.high > minGap) {
      events.push({
        type: "FVG",
        direction: "bearish",
        label: "FVG bajista",
        detail: `Vacío de valor justo en ${c3.high.toFixed(0)}-${c1.low.toFixed(0)}`,
        price: (c3.high + c1.low) / 2,
      });
    }
  }
  return events.slice(-3);
}

function detectLiquiditySweeps(candles: Candle[], swings: Swing[]): SmcEvent[] {
  const events: SmcEvent[] = [];
  const last = candles[candles.length - 1];

  swings.filter((s) => s.type === "high").slice(-3).forEach((swing) => {
    if (last.high > swing.price && last.close < swing.price) {
      events.push({
        type: "LIQUIDITY_SWEEP",
        direction: "bearish",
        label: "Sweep de liquidez alcista (trampa)",
        detail: `Barrido sobre ${swing.price.toFixed(0)} con cierre por debajo`,
        price: swing.price,
      });
    }
  });

  swings.filter((s) => s.type === "low").slice(-3).forEach((swing) => {
    if (last.low < swing.price && last.close > swing.price) {
      events.push({
        type: "LIQUIDITY_SWEEP",
        direction: "bullish",
        label: "Sweep de liquidez bajista (trampa)",
        detail: `Barrido bajo ${swing.price.toFixed(0)} con cierre por encima`,
        price: swing.price,
      });
    }
  });

  return events;
}

function detectOrderBlocks(candles: Candle[], swings: Swing[]): SmcEvent[] {
  const bosEvents = detectBosChoch(candles, swings).filter((e) => e.type === "BOS");
  const events: SmcEvent[] = [];

  bosEvents.forEach((bos) => {
    // Find the candle just before the BOS price level
    const bosCandle = candles.find((c) => Math.abs(c.close - bos.price) / bos.price < 0.002);
    if (!bosCandle) return;
    const oblIdx = candles.indexOf(bosCandle) - 1;
    if (oblIdx < 0) return;
    const oblCandle = candles[oblIdx];

    if (bos.direction === "bullish" && oblCandle.close < oblCandle.open) {
      events.push({
        type: "ORDER_BLOCK",
        direction: "bullish",
        label: "Order Block alcista",
        detail: `OB en zona ${oblCandle.low.toFixed(0)}-${oblCandle.high.toFixed(0)}`,
        price: (oblCandle.high + oblCandle.low) / 2,
      });
    } else if (bos.direction === "bearish" && oblCandle.close > oblCandle.open) {
      events.push({
        type: "ORDER_BLOCK",
        direction: "bearish",
        label: "Order Block bajista",
        detail: `OB en zona ${oblCandle.low.toFixed(0)}-${oblCandle.high.toFixed(0)}`,
        price: (oblCandle.high + oblCandle.low) / 2,
      });
    }
  });

  return events.slice(-2);
}

export function detectSmcEvents(candles: Candle[]): SmcEvent[] {
  if (candles.length < SMC_LOOKBACK * 2 + 1) return [];
  const swings = findSwings(candles, SMC_LOOKBACK);
  return [
    ...detectBosChoch(candles, swings),
    ...detectFVG(candles),
    ...detectLiquiditySweeps(candles, swings),
    ...detectOrderBlocks(candles, swings),
  ];
}

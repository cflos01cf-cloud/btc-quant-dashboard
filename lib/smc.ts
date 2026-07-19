import { Candle, Direction, SmcEvent } from "./types";

/**
 * FIX #10 — BOS/CHOCH lookback increased from 2 to 5.
 *
 * Previous: findSwings() used lookback=2, meaning a candle qualified as a
 * swing high if its high was the highest of only 5 candles (2 before + itself
 * + 2 after). In a strong trend almost every candle triggers a swing, making
 * BOS/CHOCH fire on every bar — useless noise.
 *
 * Standard SMC / ICT implementations use lookback ≥ 5 for meaningful swings.
 * With lookback=5, a swing high requires being the highest of 11 candles,
 * which filters out noise while still catching significant structure breaks.
 *
 * Practical effect: BOS/CHOCH now fires roughly 3-5x less often, focusing
 * only on structurally significant breakouts.
 */
const SMC_LOOKBACK = 5; // was 2

interface Swing {
  index: number;
  price: number;
  type: "high" | "low";
}

function findSwings(candles: Candle[], lookback = SMC_LOOKBACK): Swing[] {
  const swings: Swing[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const window = candles.slice(i - lookback, i + lookback + 1);
    const isSwingHigh = candles[i].high === Math.max(...window.map((c) => c.high));
    const isSwingLow = candles[i].low === Math.min(...window.map((c) => c.low));
    if (isSwingHigh) swings.push({ index: i, price: candles[i].high, type: "high" });
    if (isSwingLow) swings.push({ index: i, price: candles[i].low, type: "low" });
  }
  return swings;
}

function detectBosChoch(candles: Candle[], swings: Swing[]): SmcEvent[] {
  const events: SmcEvent[] = [];
  const highs = swings.filter((s) => s.type === "high");
  const lows = swings.filter((s) => s.type === "low");

  // BOS bullish: price closes above the last significant swing high
  for (let i = 1; i < highs.length; i++) {
    const prevHigh = highs[i - 1];
    const breakCandle = candles.slice(prevHigh.index + 1).find(
      (c) => c.close > prevHigh.price
    );
    if (breakCandle) {
      events.push({
        type: "BOS",
        direction: "bullish",
        label: "BOS alcista",
        detail: `Ruptura de estructura sobre ${prevHigh.price.toFixed(0)}`,
        price: prevHigh.price,
      });
    }
  }

  // BOS bearish: price closes below the last significant swing low
  for (let i = 1; i < lows.length; i++) {
    const prevLow = lows[i - 1];
    const breakCandle = candles.slice(prevLow.index + 1).find(
      (c) => c.close < prevLow.price
    );
    if (breakCandle) {
      events.push({
        type: "BOS",
        direction: "bearish",
        label: "BOS bajista",
        detail: `Ruptura de estructura bajo ${prevLow.price.toFixed(0)}`,
        price: prevLow.price,
        index: prevLow.index,
      });
    }
  }

  // CHOCH: when the last BOS direction reverses
  const lastBullBos = [...events].reverse().find(
    (e) => e.type === "BOS" && e.direction === "bullish"
  );
  const lastBearBos = [...events].reverse().find(
    (e) => e.type === "BOS" && e.direction === "bearish"
  );

  if (lastBullBos && lastBearBos) {
    const reversal =
      lastBullBos.index > lastBearBos.index
        ? null
        : {
            type: "CHOCH" as const,
            direction: "bullish" as Direction,
            label: "CHOCH — cambio de carácter alcista",
            detail: "Posible reversión de tendencia bajista",
            price: lastBearBos.price,
            index: lastBearBos.index,
          };
    if (reversal) events.push(reversal);
  }

  return events.slice(-5);
}

function detectFVG(candles: Candle[]): SmcEvent[] {
  const events: SmcEvent[] = [];
  for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2];
    const c3 = candles[i];
    // Bullish FVG: gap between c1.high and c3.low (c3.low > c1.high)
    if (c3.low > c1.high && c3.low - c1.high > candles[i - 1].close * 0.001) {
      events.push({
        type: "FVG",
        direction: "bullish",
        label: "FVG alcista",
        detail: `Vacío de valor justo en ${c1.high.toFixed(0)}-${c3.low.toFixed(0)}`,
        price: (c1.high + c3.low) / 2,
        index: i,
      });
    }
    // Bearish FVG: gap between c3.high and c1.low (c3.high < c1.low)
    if (c1.low > c3.high && c1.low - c3.high > candles[i - 1].close * 0.001) {
      events.push({
        type: "FVG",
        direction: "bearish",
        label: "FVG bajista",
        detail: `Vacío de valor justo en ${c3.high.toFixed(0)}-${c1.low.toFixed(0)}`,
        price: (c3.high + c1.low) / 2,
        index: i,
      });
    }
  }
  return events.slice(-3);
}

function detectLiquiditySweeps(candles: Candle[], swings: Swing[]): SmcEvent[] {
  const events: SmcEvent[] = [];
  const last = candles[candles.length - 1];
  const recentHighs = swings
    .filter((s) => s.type === "high")
    .slice(-3);
  const recentLows = swings
    .filter((s) => s.type === "low")
    .slice(-3);

  recentHighs.forEach((swing) => {
    if (last.high > swing.price && last.close < swing.price) {
      events.push({
        type: "LIQUIDITY_SWEEP",
        direction: "bearish",
        label: "Sweep de liquidez alcista (trampa)",
        detail: `Barrido sobre ${swing.price.toFixed(0)} con cierre por debajo`,
        price: swing.price,
        index: swing.index,
      });
    }
  });

  recentLows.forEach((swing) => {
    if (last.low < swing.price && last.close > swing.price) {
      events.push({
        type: "LIQUIDITY_SWEEP",
        direction: "bullish",
        label: "Sweep de liquidez bajista (trampa)",
        detail: `Barrido bajo ${swing.price.toFixed(0)} con cierre por encima`,
        price: swing.price,
        index: swing.index,
      });
    }
  });

  return events;
}

function detectOrderBlocks(candles: Candle[], swings: Swing[]): SmcEvent[] {
  const events: SmcEvent[] = [];
  const bosEvents = detectBosChoch(candles, swings).filter(
    (e) => e.type === "BOS"
  );

  bosEvents.forEach((bos) => {
    const oblCandle = candles[Math.max(0, bos.index - 1)];
    if (!oblCandle) return;
    const isBullishOB =
      bos.direction === "bullish" && oblCandle.close < oblCandle.open;
    const isBearishOB =
      bos.direction === "bearish" && oblCandle.close > oblCandle.open;

    if (isBullishOB) {
      events.push({
        type: "ORDER_BLOCK",
        direction: "bullish",
        label: "Order Block alcista",
        detail: `OB en zona ${oblCandle.low.toFixed(0)}-${oblCandle.high.toFixed(0)}`,
        price: (oblCandle.high + oblCandle.low) / 2,
        index: bos.index - 1,
      });
    } else if (isBearishOB) {
      events.push({
        type: "ORDER_BLOCK",
        direction: "bearish",
        label: "Order Block bajista",
        detail: `OB en zona ${oblCandle.low.toFixed(0)}-${oblCandle.high.toFixed(0)}`,
        price: (oblCandle.high + oblCandle.low) / 2,
        index: bos.index - 1,
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

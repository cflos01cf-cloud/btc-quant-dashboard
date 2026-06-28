import {
  Candle,
  DerivativesSnapshot,
  FearGreed,
  NewsHeadline,
  WhaleSummary,
} from "./types";

/**
 * Demo mode is an explicit, user-selected toggle — it never engages
 * automatically. The server only returns synthetic data when `mode=demo`
 * is requested directly, or as a clearly-labeled fallback (with `warning`
 * set) if a live request genuinely fails. This avoids the "live/demo
 * flapping" bug from the EUR/USD dashboard, where the source could swap
 * silently mid-session.
 */

function seededRandom(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function buildDemoCandles(count = 300, basePrice = 64000): Candle[] {
  const seed = Math.floor(Date.now() / (1000 * 60 * 60));
  const rand = seededRandom(seed);
  const candles: Candle[] = [];
  let price = basePrice;
  const now = Date.now();
  const stepMs = 15 * 60 * 1000;

  for (let i = count - 1; i >= 0; i--) {
    const drift = (rand() - 0.5) * 0.006;
    const open = price;
    price = price * (1 + drift);
    const close = price;
    const wick = Math.abs(close - open) * (1 + rand());
    const high = Math.max(open, close) + wick * rand();
    const low = Math.min(open, close) - wick * rand();
    const volume = 80 + rand() * 220;
    candles.push({ time: now - i * stepMs, open, high, low, close, volume });
  }
  return candles;
}

export function buildDemoOrderBook() {
  const bidVolume = 120 + Math.random() * 40;
  const askVolume = 120 + Math.random() * 40;
  return { bidVolume, askVolume, imbalanceRatio: bidVolume / askVolume };
}

export function buildDemoDerivatives(): DerivativesSnapshot {
  return {
    fundingRate: 0.0001,
    markPrice: null,
    openInterest: 145_000,
    openInterestChangePct: 1.2,
    longShortRatio: 1.05,
  };
}

export function buildDemoWhales(): WhaleSummary {
  return {
    windowMinutes: 30,
    largeTradeThresholdUsd: 250_000,
    buyVolume: 18.4,
    sellVolume: 15.1,
    netDirection: "bullish",
    tradeCount: 6,
  };
}

export function buildDemoFearGreed(): FearGreed {
  return { value: 54, classification: "Neutral (demo)" };
}

export function buildDemoNews(): NewsHeadline[] {
  const now = Date.now();
  return [
    {
      title: "[DEMO] Bitcoin consolida cerca de máximos mientras el mercado espera catalizadores",
      link: "#",
      publishedAt: now - 1000 * 60 * 30,
      sentiment: "neutral",
      source: "Demo",
    },
    {
      title: "[DEMO] Inflows a ETFs de Bitcoin se mantienen positivos por tercera semana",
      link: "#",
      publishedAt: now - 1000 * 60 * 90,
      sentiment: "bullish",
      source: "Demo",
    },
    {
      title: "[DEMO] Reguladores examinan nuevas reglas para exchanges de criptomonedas",
      link: "#",
      publishedAt: now - 1000 * 60 * 180,
      sentiment: "bearish",
      source: "Demo",
    },
  ];
}

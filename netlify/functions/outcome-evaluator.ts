import type { Config } from "@netlify/functions";
import { getBitsoTicker } from "../../lib/bitso";
import { getLiveBtcData } from "../../lib/marketdata";
import {
  listOpenSignals,
  updateSignalStatus,
} from "../../lib/blobstore";
import { SignalRecord, SignalStatus } from "../../lib/types";

/**
 * Runs every hour. Checks all open signals (both Coinbase and Bitso) against
 * their respective current prices and marks them as TP/SL hit or expired.
 *
 * Price comparison is in % terms (not absolute) to normalize across
 * MXN (Bitso) and USD (Coinbase) — this was the design decision in the
 * spec discussion.
 */

async function getCurrentPricePct(
  signal: SignalRecord
): Promise<number | null> {
  try {
    if (signal.source === "bitso") {
      const ticker = await getBitsoTicker();
      if (ticker.lastPrice === null) return null;
      return ((ticker.lastPrice - signal.priceReference) / signal.priceReference) * 100;
    } else {
      const data = await getLiveBtcData("1h", 2);
      const current = data.candles[data.candles.length - 1].close;
      return ((current - signal.priceReference) / signal.priceReference) * 100;
    }
  } catch {
    return null;
  }
}

function evaluateSignal(
  signal: SignalRecord,
  currentPctMove: number
): SignalStatus {
  const now = Date.now();

  // Auto-expire
  if (now >= signal.expiresAt) return "expired";

  const dir = signal.direction === "bullish" ? 1 : -1;
  // Adjust move direction: for a SHORT, a price DROP is favorable
  const adjustedMove = currentPctMove * dir;
  const adjustedSL = Math.abs(signal.stopLossPct);
  const adjustedTP1 = Math.abs(signal.tp1Pct);
  const adjustedTP2 = Math.abs(signal.tp2Pct);
  const adjustedTP3 = Math.abs(signal.tp3Pct);

  if (adjustedMove <= -adjustedSL) return "sl_hit";
  if (adjustedMove >= adjustedTP3) return "tp3_hit";
  if (adjustedMove >= adjustedTP2) return "tp2_hit";
  if (adjustedMove >= adjustedTP1) return "tp1_hit";
  return "open";
}

export default async () => {
  const results: { id: string; source: string; old: string; new: string }[] = [];

  try {
    const [coinbaseOpen, bitsoOpen] = await Promise.all([
      listOpenSignals("coinbase"),
      listOpenSignals("bitso"),
    ]);

    const allOpen = [...coinbaseOpen, ...bitsoOpen];

    for (const signal of allOpen) {
      const pctMove = await getCurrentPricePct(signal);
      if (pctMove === null) continue;

      const newStatus = evaluateSignal(signal, pctMove);

      if (newStatus !== "open") {
        const closePricePct = pctMove * (signal.direction === "bullish" ? 1 : -1);
        await updateSignalStatus(signal.source, signal.id, {
          status: newStatus,
          closedAt: Date.now(),
          closePricePct,
          // Simplified MFE/MAE: use current move as proxy (a real implementation
          // would track intra-signal high/low by storing price snapshots).
          mfePct: closePricePct > 0 ? closePricePct : 0,
          maePct: closePricePct < 0 ? Math.abs(closePricePct) : 0,
        });
        results.push({
          id: signal.id,
          source: signal.source,
          old: "open",
          new: newStatus,
        });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, evaluated: allOpen.length, closed: results }),
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[outcome-evaluator] error:", err?.message);
    return new Response(
      JSON.stringify({ ok: false, error: err?.message }),
      { status: 200 }
    );
  }
};

export const config: Config = {
  schedule: "0 * * * *", // every hour on the hour
};

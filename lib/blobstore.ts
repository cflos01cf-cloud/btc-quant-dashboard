import { getStore } from "@netlify/blobs";
import {
  CompareStats,
  SignalRecord,
  SignalSource,
  SignalStatus,
  Verdict,
} from "./types";

/**
 * Persistence layer for signal outcome tracking, built on Netlify Blobs.
 *
 * Key schema:
 *   signals:coinbase:{id}   → SignalRecord (JSON)
 *   signals:bitso:{id}      → SignalRecord (JSON)
 *
 * We use per-record keys (not one giant array) so updates to individual
 * signal statuses don't require reading and rewriting the entire list.
 * The `list()` call with a prefix lets us paginate through all signals
 * for a given source efficiently.
 */

function signalStore() {
  return getStore({ name: "signal-outcomes", consistency: "strong" });
}

function signalKey(source: SignalSource, id: string) {
  return `signals:${source}:${id}`;
}

export async function saveSignal(signal: SignalRecord): Promise<void> {
  const store = signalStore();
  await store.setJSON(signalKey(signal.source, signal.id), signal);
}

export async function getSignal(
  source: SignalSource,
  id: string
): Promise<SignalRecord | null> {
  const store = signalStore();
  try {
    return await store.get(signalKey(source, id), { type: "json" }) as SignalRecord;
  } catch {
    return null;
  }
}

export async function updateSignalStatus(
  source: SignalSource,
  id: string,
  update: Partial<Pick<SignalRecord, "status" | "closedAt" | "closePricePct" | "mfePct" | "maePct">>
): Promise<void> {
  const existing = await getSignal(source, id);
  if (!existing) return;
  await saveSignal({ ...existing, ...update });
}

export async function listSignals(
  source: SignalSource,
  limit = 200
): Promise<SignalRecord[]> {
  const store = signalStore();
  const prefix = `signals:${source}:`;
  try {
    const { blobs } = await store.list({ prefix });
    const keys = blobs.map((b) => b.key).slice(-limit);
    const records = await Promise.all(
      keys.map(async (key) => {
        try {
          return await store.get(key, { type: "json" }) as SignalRecord;
        } catch {
          return null;
        }
      })
    );
    return records
      .filter((r): r is SignalRecord => r !== null)
      .sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export async function listOpenSignals(source: SignalSource): Promise<SignalRecord[]> {
  const all = await listSignals(source);
  return all.filter((s) => s.status === "open");
}

/**
 * Compute comparative statistics for a given source.
 * "Win" = signal that hit TP1 or better before hitting SL or expiring.
 */
export function computeStats(signals: SignalRecord[]): CompareStats {
  const closed = signals.filter((s) => s.status !== "open");
  const wins = closed.filter(
    (s) =>
      s.status === "tp1_hit" ||
      s.status === "tp2_hit" ||
      s.status === "tp3_hit"
  );
  const losses = closed.filter(
    (s) => s.status === "sl_hit" || s.status === "expired"
  );

  const avgScore = (arr: SignalRecord[]) =>
    arr.length > 0
      ? arr.reduce((s, r) => s + r.score, 0) / arr.length
      : null;

  const expectancy =
    closed.length > 0
      ? closed.reduce((s, r) => s + (r.closePricePct ?? 0), 0) / closed.length
      : null;

  // Score buckets: 60-70, 70-80, 80-85, 85+
  const buckets = [
    { label: "60-70", min: 60, max: 70 },
    { label: "70-80", min: 70, max: 80 },
    { label: "80-85", min: 80, max: 85 },
    { label: "85+", min: 85, max: 101 },
  ];

  const byScoreBucket = buckets.map(({ label, min, max }) => {
    const inBucket = closed.filter((s) => s.score >= min && s.score < max);
    const winsInBucket = inBucket.filter(
      (s) =>
        s.status === "tp1_hit" ||
        s.status === "tp2_hit" ||
        s.status === "tp3_hit"
    );
    return {
      bucket: label,
      total: inBucket.length,
      wins: winsInBucket.length,
      winRate:
        inBucket.length > 0
          ? (winsInBucket.length / inBucket.length) * 100
          : null,
    };
  });

  return {
    source: signals[0]?.source ?? "coinbase",
    totalSignals: signals.length,
    closedSignals: closed.length,
    winRate:
      closed.length > 0 ? (wins.length / closed.length) * 100 : null,
    avgScoreOnWins: avgScore(wins),
    avgScoreOnLosses: avgScore(losses),
    expectancyPct: expectancy,
    byScoreBucket,
  };
}

/**
 * Build a new SignalRecord from score engine output.
 * SL = 1.5× ATR from entry (expressed as %).
 * TP1/2/3 = 1.5×/2.5×/4× risk (same ratios as the main dashboard).
 */
export function buildSignalRecord(args: {
  source: SignalSource;
  verdict: Verdict;
  direction: "bullish" | "bearish";
  score: number;
  priceReference: number;
  currency: "MXN" | "USD";
  atr: number;
}): SignalRecord {
  const { source, verdict, direction, score, priceReference, currency, atr } = args;
  const riskPct = (atr * 1.5) / priceReference; // fraction, e.g. 0.015 = 1.5%
  const sign = direction === "bullish" ? 1 : -1;

  const now = Date.now();
  const id = `${source}-${now}`;

  return {
    id,
    source,
    createdAt: now,
    verdict,
    direction,
    score,
    priceReference,
    currency,
    stopLossPct: -riskPct * 100 * sign,   // negative for longs, positive for shorts
    tp1Pct: riskPct * 100 * 1.5 * sign,
    tp2Pct: riskPct * 100 * 2.5 * sign,
    tp3Pct: riskPct * 100 * 4.0 * sign,
    status: "open",
    closedAt: null,
    closePricePct: null,
    mfePct: null,
    maePct: null,
    expiresAt: now + 24 * 60 * 60_000,    // auto-expire after 24h
  };
}

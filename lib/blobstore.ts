/**
 * Persistence layer for signal outcome tracking.
 *
 * v1 used Netlify Blobs. v2 uses Supabase PostgreSQL — same public interface,
 * so bitso-tracker.ts, scheduled-alert.ts, outcome-evaluator.ts and
 * app/api/compare/route.ts require zero changes.
 *
 * Table: signal_records (created via SQL Editor in Supabase dashboard)
 *   id TEXT PRIMARY KEY
 *   source TEXT
 *   created_at BIGINT
 *   verdict TEXT
 *   direction TEXT
 *   score NUMERIC
 *   price_reference NUMERIC
 *   currency TEXT
 *   stop_loss_pct NUMERIC
 *   tp1_pct NUMERIC
 *   tp2_pct NUMERIC
 *   tp3_pct NUMERIC
 *   status TEXT DEFAULT 'open'
 *   closed_at BIGINT
 *   close_price_pct NUMERIC
 *   mfe_pct NUMERIC
 *   mae_pct NUMERIC
 *   expires_at BIGINT
 */

import { getSupabaseServer } from "./supabase";
import {
  CompareStats,
  SignalRecord,
  SignalSource,
  SignalStatus,
  Verdict,
} from "./types";

const TABLE = "signal_records";

/** Convert snake_case DB row → camelCase SignalRecord */
function fromRow(row: any): SignalRecord {
  return {
    id: row.id,
    source: row.source,
    createdAt: row.created_at,
    verdict: row.verdict,
    direction: row.direction,
    score: row.score,
    priceReference: row.price_reference,
    currency: row.currency,
    stopLossPct: row.stop_loss_pct,
    tp1Pct: row.tp1_pct,
    tp2Pct: row.tp2_pct,
    tp3Pct: row.tp3_pct,
    status: row.status,
    closedAt: row.closed_at ?? null,
    closePricePct: row.close_price_pct ?? null,
    mfePct: row.mfe_pct ?? null,
    maePct: row.mae_pct ?? null,
    expiresAt: row.expires_at,
  };
}

/** Convert camelCase SignalRecord → snake_case DB row */
function toRow(s: SignalRecord) {
  return {
    id: s.id,
    source: s.source,
    created_at: s.createdAt,
    verdict: s.verdict,
    direction: s.direction,
    score: s.score,
    price_reference: s.priceReference,
    currency: s.currency,
    stop_loss_pct: s.stopLossPct,
    tp1_pct: s.tp1Pct,
    tp2_pct: s.tp2Pct,
    tp3_pct: s.tp3Pct,
    status: s.status,
    closed_at: s.closedAt,
    close_price_pct: s.closePricePct,
    mfe_pct: s.mfePct,
    mae_pct: s.maePct,
    expires_at: s.expiresAt,
  };
}

export async function saveSignal(signal: SignalRecord): Promise<void> {
  const sb = getSupabaseServer();
  const { error } = await sb.from(TABLE).upsert(toRow(signal));
  if (error) throw new Error(`saveSignal: ${error.message}`);
}

export async function getSignal(
  _source: SignalSource,
  id: string
): Promise<SignalRecord | null> {
  const sb = getSupabaseServer();
  const { data, error } = await sb
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return fromRow(data);
}

export async function updateSignalStatus(
  source: SignalSource,
  id: string,
  update: Partial<
    Pick<
      SignalRecord,
      "status" | "closedAt" | "closePricePct" | "mfePct" | "maePct"
    >
  >
): Promise<void> {
  const sb = getSupabaseServer();
  const patch: Record<string, any> = {};
  if (update.status !== undefined) patch.status = update.status;
  if (update.closedAt !== undefined) patch.closed_at = update.closedAt;
  if (update.closePricePct !== undefined)
    patch.close_price_pct = update.closePricePct;
  if (update.mfePct !== undefined) patch.mfe_pct = update.mfePct;
  if (update.maePct !== undefined) patch.mae_pct = update.maePct;

  const { error } = await sb
    .from(TABLE)
    .update(patch)
    .eq("id", id)
    .eq("source", source);
  if (error) throw new Error(`updateSignalStatus: ${error.message}`);
}

export async function listSignals(
  source: SignalSource,
  limit = 200
): Promise<SignalRecord[]> {
  const sb = getSupabaseServer();
  const { data, error } = await sb
    .from(TABLE)
    .select("*")
    .eq("source", source)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`listSignals: ${error.message}`);
  return (data ?? []).map(fromRow);
}

export async function listOpenSignals(
  source: SignalSource
): Promise<SignalRecord[]> {
  const sb = getSupabaseServer();
  const { data, error } = await sb
    .from(TABLE)
    .select("*")
    .eq("source", source)
    .eq("status", "open")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listOpenSignals: ${error.message}`);
  return (data ?? []).map(fromRow);
}

/**
 * Compute comparative statistics for a given source.
 * "Win" = signal that hit TP1 or better before hitting SL or expiring.
 */
export function computeStats(signals: SignalRecord[]): CompareStats {
  const source = signals[0]?.source ?? "coinbase";
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
      ? closed.reduce((s, r) => s + (r.closePricePct ?? 0), 0) /
        closed.length
      : null;

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
    source,
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
  const { source, verdict, direction, score, priceReference, currency, atr } =
    args;
  const riskPct = (atr * 1.5) / priceReference;
  const sign = direction === "bullish" ? 1 : -1;
  const now = Date.now();

  return {
    id: `${source}-${now}`,
    source,
    createdAt: now,
    verdict,
    direction,
    score,
    priceReference,
    currency,
    stopLossPct: -riskPct * 100 * sign,
    tp1Pct: riskPct * 100 * 1.5 * sign,
    tp2Pct: riskPct * 100 * 2.5 * sign,
    tp3Pct: riskPct * 100 * 4.0 * sign,
    status: "open",
    closedAt: null,
    closePricePct: null,
    mfePct: null,
    maePct: null,
    expiresAt: now + 24 * 60 * 60_000,
  };
}

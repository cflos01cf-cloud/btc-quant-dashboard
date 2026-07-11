"use client";

import { useEffect, useState } from "react";
import { ComparePayload, SignalRecord } from "@/lib/types";
import { timeAgo } from "@/lib/format";

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  open: { label: "Abierta", color: "text-bitcoin" },
  tp1_hit: { label: "TP1 ✓", color: "text-bull" },
  tp2_hit: { label: "TP2 ✓✓", color: "text-bull" },
  tp3_hit: { label: "TP3 ✓✓✓", color: "text-bull" },
  sl_hit: { label: "SL ✗", color: "text-bear" },
  expired: { label: "Expirada", color: "text-ink-500" },
};

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" | "neutral" }) {
  return (
    <div className="rounded-lg bg-surface2/60 border border-edge px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-ink-500">{label}</p>
      <p className={`font-mono tabular text-sm ${tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-ink-100"}`}>
        {value}
      </p>
    </div>
  );
}

function SourceBlock({ stats, title }: { stats: ComparePayload["coinbase"]; title: string }) {
  const noData = stats.totalSignals === 0;
  return (
    <div className="rounded-xl border border-edge bg-surface/70 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-ink-500 mb-3">{title}</p>
      {noData ? (
        <p className="text-sm text-ink-500 italic">
          Sin señales registradas todavía — el tracker lleva corriendo poco tiempo o el score
          no ha superado 60/100.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <StatCard label="Total señales" value={`${stats.totalSignals}`} />
            <StatCard label="Cerradas" value={`${stats.closedSignals}`} />
            <StatCard
              label="Win rate"
              value={stats.winRate !== null ? `${stats.winRate.toFixed(0)}%` : "—"}
              tone={stats.winRate !== null ? (stats.winRate >= 50 ? "bull" : "bear") : "neutral"}
            />
            <StatCard
              label="Expectancy"
              value={stats.expectancyPct !== null ? `${stats.expectancyPct >= 0 ? "+" : ""}${stats.expectancyPct.toFixed(2)}%` : "—"}
              tone={stats.expectancyPct !== null ? (stats.expectancyPct >= 0 ? "bull" : "bear") : "neutral"}
            />
          </div>
          {stats.byScoreBucket.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-ink-500 mb-1">Win rate por score bucket</p>
              <div className="space-y-1">
                {stats.byScoreBucket.map((b) => (
                  <div key={b.bucket} className="flex items-center gap-2 text-xs">
                    <span className="w-12 text-ink-500 font-mono">{b.bucket}</span>
                    <div className="flex-1 h-2 rounded-full bg-surface2 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${(b.winRate ?? 0) >= 50 ? "bg-bull" : "bg-bear"}`}
                        style={{ width: `${b.winRate ?? 0}%` }}
                      />
                    </div>
                    <span className="w-20 text-right text-ink-300 font-mono">
                      {b.total > 0
                        ? `${b.wins}/${b.total} (${b.winRate?.toFixed(0) ?? "—"}%)`
                        : "sin datos"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SignalRow({ signal }: { signal: SignalRecord }) {
  const st = STATUS_LABEL[signal.status] ?? { label: signal.status, color: "text-ink-500" };
  return (
    <div className="flex items-center gap-3 rounded-lg bg-surface2/40 border border-edge px-3 py-2 text-xs">
      <span className={`font-mono px-1.5 py-0.5 rounded text-[10px] ${signal.source === "bitso" ? "bg-bitcoin/20 text-bitcoin" : "bg-bull/20 text-bull"}`}>
        {signal.source === "bitso" ? "BITSO" : "COINBASE"}
      </span>
      <span className={`font-mono px-1 py-0.5 rounded ${signal.verdict === "COMPRAR" ? "text-bull bg-bull-dim/30" : "text-bear bg-bear-dim/30"}`}>
        {signal.verdict}
      </span>
      <span className="font-mono text-ink-500">{signal.score.toFixed(0)}/100</span>
      <span className={`font-mono ${st.color}`}>{st.label}</span>
      {signal.closePricePct !== null && (
        <span className={`font-mono ml-auto ${signal.closePricePct >= 0 ? "text-bull" : "text-bear"}`}>
          {signal.closePricePct >= 0 ? "+" : ""}{signal.closePricePct.toFixed(2)}%
        </span>
      )}
      <span className="text-ink-500 ml-auto">{timeAgo(signal.createdAt)}</span>
    </div>
  );
}

export default function ComparePanel() {
  const [data, setData] = useState<ComparePayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/compare")
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-edge bg-surface/70 p-8 text-center text-ink-500 font-mono text-sm">
        Cargando comparativa…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-edge bg-surface/70 p-4">
        <p className="text-xs uppercase tracking-[0.18em] text-ink-500 mb-1">
          Shadow Trading — Comparativa Coinbase vs Bitso
        </p>
        <p className="text-xs text-ink-500">
          El tracker registra señales automáticamente cuando el score supera 60/100 (umbral
          más bajo que las alertas de Telegram, para acumular datos). Objetivo: 30-40 señales
          cerradas por fuente en 4-6 semanas, luego decidimos cuál fuente usar para ejecución real.
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <SourceBlock stats={data?.coinbase ?? { source: "coinbase", totalSignals: 0, closedSignals: 0, winRate: null, avgScoreOnWins: null, avgScoreOnLosses: null, expectancyPct: null, byScoreBucket: [] }} title="Coinbase (BTC/USD)" />
        <SourceBlock stats={data?.bitso ?? { source: "bitso", totalSignals: 0, closedSignals: 0, winRate: null, avgScoreOnWins: null, avgScoreOnLosses: null, expectancyPct: null, byScoreBucket: [] }} title="Bitso (BTC/MXN)" />
      </div>

      {data?.openSignals && data.openSignals.length > 0 && (
        <div className="rounded-xl border border-edge bg-surface/70 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-ink-500 mb-3">
            Señales abiertas ({data.openSignals.length})
          </p>
          <div className="space-y-1.5">
            {data.openSignals.map((s) => <SignalRow key={s.id} signal={s} />)}
          </div>
        </div>
      )}

      {data?.recentClosed && data.recentClosed.length > 0 && (
        <div className="rounded-xl border border-edge bg-surface/70 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-ink-500 mb-3">
            Últimas señales cerradas
          </p>
          <div className="space-y-1.5">
            {data.recentClosed.map((s) => <SignalRow key={s.id} signal={s} />)}
          </div>
        </div>
      )}

      {data && data.openSignals.length === 0 && data.recentClosed.length === 0 && (
        <div className="rounded-xl border border-edge bg-surface/70 p-6 text-center text-ink-500 text-sm">
          Todavía no hay señales registradas. Las funciones programadas comenzarán a
          registrar señales la próxima vez que el score supere 60/100.
        </div>
      )}
    </div>
  );
}

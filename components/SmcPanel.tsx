"use client";

import { ArrowUpRight, ArrowDownRight, Waves } from "lucide-react";
import { SmcEvent, WhaleSummary } from "@/lib/types";

const ICON = {
  bullish: <ArrowUpRight className="h-4 w-4 text-bull" />,
  bearish: <ArrowDownRight className="h-4 w-4 text-bear" />,
  neutral: <Waves className="h-4 w-4 text-ink-500" />,
};

const ROW_BG = {
  bullish: "bg-bull-dim/20 border-bull/20",
  bearish: "bg-bear-dim/20 border-bear/20",
  neutral: "bg-surface2/40 border-edge",
};

export default function SmcPanel({ events, whales }: { events: SmcEvent[]; whales: WhaleSummary }) {
  return (
    <div className="rounded-xl border border-edge bg-surface/70 p-5">
      <p className="text-xs uppercase tracking-[0.18em] text-ink-500 mb-1">
        Smart Money Concepts (heurístico)
      </p>
      <p className="text-xs text-ink-500 mb-3">
        Detección simplificada de BOS/CHOCH, Fair Value Gaps, barridos de liquidez y order blocks —
        no es un motor ICT institucional, es un apoyo de contexto.
      </p>

      <div className="space-y-2 mb-4">
        {events.length === 0 && (
          <p className="text-sm text-ink-500 italic">Sin eventos relevantes detectados en la ventana actual.</p>
        )}
        {events.map((e, idx) => (
          <div key={idx} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${ROW_BG[e.direction]}`}>
            {ICON[e.direction]}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink-100">{e.label}</p>
              <p className="text-xs text-ink-500 truncate">{e.detail}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-edge bg-surface2/50 px-3 py-3">
        <p className="text-[11px] uppercase tracking-wide text-ink-500 mb-1">
          Ballenas (aproximado, trades públicos &gt; ${(whales.largeTradeThresholdUsd / 1000).toFixed(0)}k)
        </p>
        {whales.tradeCount === 0 ? (
          <p className="text-sm text-ink-500 italic">Sin operaciones grandes en los últimos {whales.windowMinutes} min.</p>
        ) : (
          <p className="text-sm font-mono tabular text-ink-100">
            {whales.buyVolume.toFixed(1)} BTC compra{" "}
            <span className="text-ink-500">vs</span>{" "}
            {whales.sellVolume.toFixed(1)} BTC venta{" "}
            <span
              className={whales.netDirection === "bullish" ? "text-bull" : whales.netDirection === "bearish" ? "text-bear" : "text-ink-500"}
            >
              ({whales.netDirection === "bullish" ? "sesgo comprador" : whales.netDirection === "bearish" ? "sesgo vendedor" : "neutral"})
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

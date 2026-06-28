"use client";

import { Bitcoin, Radio, FlaskConical } from "lucide-react";
import { BtcDashboardPayload } from "@/lib/types";
import { fmtPct, fmtUsd, timeAgo } from "@/lib/format";
import ThemeToggle from "./ThemeToggle";

export default function PriceHeader({
  data,
  mode,
  onModeChange,
  isLoading,
}: {
  data: BtcDashboardPayload | null;
  mode: "live" | "demo";
  onModeChange: (m: "live" | "demo") => void;
  isLoading: boolean;
}) {
  const price = data?.indicators.price ?? 0;
  const change = data?.priceChangePct24h ?? 0;
  const positive = change >= 0;

  return (
    <div className="rounded-xl border border-edge bg-surface/70 p-5">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-bitcoin/15 border border-bitcoin/40 flex items-center justify-center">
            <Bitcoin className="h-5 w-5 text-bitcoin" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-ink-500">
              {data?.symbol ?? "BTC/USD"} · {data?.interval ?? "15m"}
              {data && data.resolvedInterval !== data.interval && (
                <span className="text-bitcoin"> (usando {data.resolvedInterval} reales)</span>
              )}
            </p>
            <p className="font-mono text-4xl tabular leading-tight text-ink-100">
              ${fmtUsd(price)}
            </p>
          </div>
          <span
            className={`self-start mt-1 font-mono text-sm px-2 py-0.5 rounded ${
              positive ? "text-bull bg-bull-dim/30" : "text-bear bg-bear-dim/30"
            }`}
          >
            {fmtPct(change)} 24h
          </span>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-edge overflow-hidden">
              <button
                onClick={() => onModeChange("live")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                  mode === "live" ? "bg-bitcoin text-[#1A1306]" : "bg-transparent text-ink-300 hover:text-ink-100"
                }`}
              >
                <Radio className="h-3.5 w-3.5" /> Live
              </button>
              <button
                onClick={() => onModeChange("demo")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                  mode === "demo" ? "bg-bitcoin text-[#1A1306]" : "bg-transparent text-ink-300 hover:text-ink-100"
                }`}
              >
                <FlaskConical className="h-3.5 w-3.5" /> Demo
              </button>
            </div>
            <ThemeToggle />
          </div>
          <p className="text-xs text-ink-500 font-mono">
            {isLoading ? "actualizando…" : data ? `actualizado ${timeAgo(data.fetchedAt)}` : "—"}
            {data?.source === "demo" && mode === "live" ? " · fallback demo" : ""}
          </p>
        </div>
      </div>

      {data?.warning && (
        <p className="mt-3 text-xs text-bear bg-bear-dim/20 border border-bear/30 rounded px-3 py-2">
          {data.warning}
        </p>
      )}
      {data?.dataNotes && data.dataNotes.length > 0 && (
        <p className="mt-2 text-xs text-ink-500">{data.dataNotes.join(" · ")}</p>
      )}

      <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <Stat label="Máx 24h" value={data?.high24h ? `$${fmtUsd(data.high24h)}` : "—"} />
        <Stat label="Mín 24h" value={data?.low24h ? `$${fmtUsd(data.low24h)}` : "—"} />
        <Stat label="Volumen 24h" value={data?.volume24h ? `${fmtUsd(data.volume24h, 0)} BTC` : "—"} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface2/60 border border-edge px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-ink-500">{label}</p>
      <p className="font-mono tabular text-ink-100">{value}</p>
    </div>
  );
}

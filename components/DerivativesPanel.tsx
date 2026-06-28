"use client";

import { DerivativesSnapshot } from "@/lib/types";

export default function DerivativesPanel({ data }: { data: DerivativesSnapshot }) {
  const items = [
    {
      label: "Funding Rate",
      value: data.fundingRate !== null ? `${(data.fundingRate * 100).toFixed(4)}%` : "n/d",
      tone:
        data.fundingRate === null
          ? "neutral"
          : data.fundingRate > 0.0005
            ? "bear"
            : data.fundingRate < -0.0003
              ? "bull"
              : "neutral",
    },
    {
      label: "Open Interest",
      value: data.openInterest !== null ? `${(data.openInterest / 1000).toFixed(1)}k BTC` : "n/d",
      tone: "neutral" as const,
    },
    {
      label: "Cambio OI (2h)",
      value: data.openInterestChangePct !== null ? `${data.openInterestChangePct >= 0 ? "+" : ""}${data.openInterestChangePct.toFixed(1)}%` : "n/d",
      tone: data.openInterestChangePct !== null && data.openInterestChangePct >= 0 ? "bull" : "bear",
    },
    {
      label: "Long/Short Ratio",
      value: data.longShortRatio !== null ? data.longShortRatio.toFixed(2) : "n/d",
      tone:
        data.longShortRatio === null
          ? "neutral"
          : data.longShortRatio > 1.5
            ? "bear"
            : data.longShortRatio < 0.67
              ? "bull"
              : "neutral",
    },
  ];

  return (
    <div className="rounded-xl border border-edge bg-surface/70 p-5">
      <p className="text-xs uppercase tracking-[0.18em] text-ink-500 mb-3">Derivados (Binance Futures)</p>
      <div className="grid grid-cols-2 gap-3">
        {items.map((it) => (
          <div key={it.label} className="rounded-lg bg-surface2/60 border border-edge px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-ink-500">{it.label}</p>
            <p
              className={`font-mono tabular text-sm ${
                it.tone === "bull" ? "text-bull" : it.tone === "bear" ? "text-bear" : "text-ink-100"
              }`}
            >
              {it.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

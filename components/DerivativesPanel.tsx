"use client";

import { DerivativesSnapshot } from "@/lib/types";

/**
 * FIX #1 (display) — Funding Rate ahora usa relativeFundingRate de Kraken,
 * que es la tasa por período de 1h expresada como fracción (ej. 0.0001 = 0.01%/h).
 * Multiplicamos × 100 para mostrar como porcentaje y × 8760 para mostrar la
 * tasa anualizada como referencia.
 *
 * FIX (OI display) — Open Interest ahora viene convertido a BTC (dividido entre
 * markPrice en el servidor), no en contratos USD.
 */
export default function DerivativesPanel({ data }: { data: DerivativesSnapshot }) {
  const fundingPct =
    data.fundingRate !== null ? data.fundingRate * 100 : null;

  const items = [
    {
      label: "Funding Rate (por hora)",
      value:
        fundingPct !== null
          ? `${fundingPct >= 0 ? "+" : ""}${fundingPct.toFixed(4)}%`
          : "n/d",
      tone:
        data.fundingRate === null
          ? "neutral"
          : data.fundingRate > 0.0005   // > +0.05%/h = longs muy cargados
            ? "bear"
            : data.fundingRate < -0.0003 // < -0.03%/h = shorts muy cargados
              ? "bull"
              : "neutral",
      note: fundingPct !== null
        ? `≈ ${(fundingPct * 8760).toFixed(1)}% anualizado`
        : undefined,
    },
    {
      label: "Open Interest (BTC)",
      value:
        data.openInterest !== null
          ? `${data.openInterest.toLocaleString("en-US", { maximumFractionDigits: 0 })} BTC`
          : "n/d",
      tone: "neutral" as const,
    },
    {
      label: "Cambio OI (2h)",
      value:
        data.openInterestChangePct !== null
          ? `${data.openInterestChangePct >= 0 ? "+" : ""}${data.openInterestChangePct.toFixed(1)}%`
          : "n/d",
      tone:
        data.openInterestChangePct !== null && data.openInterestChangePct >= 0
          ? "bull"
          : "bear",
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
      <p className="text-xs uppercase tracking-[0.18em] text-ink-500 mb-3">
        Derivados (Kraken Futures, best-effort)
      </p>
      <div className="grid grid-cols-2 gap-3">
        {items.map((it) => (
          <div key={it.label} className="rounded-lg bg-surface2/60 border border-edge px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-ink-500">{it.label}</p>
            <p
              className={`font-mono tabular text-sm ${
                it.tone === "bull"
                  ? "text-bull"
                  : it.tone === "bear"
                    ? "text-bear"
                    : "text-ink-100"
              }`}
            >
              {it.value}
            </p>
            {it.note && (
              <p className="text-[10px] text-ink-500 mt-0.5">{it.note}</p>
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-ink-500">
        Fuente: Kraken Futures (PF_XBTUSD). Funding rate = relativeFundingRate por período de 1h.
        OI convertido a BTC usando markPrice. Long/Short Ratio no disponible en esta fuente.
      </p>
    </div>
  );
}

"use client";

import { BtcDashboardPayload } from "@/lib/types";
import { fmtCompact, fmtUsd } from "@/lib/format";

export default function IndicatorGrid({ data }: { data: BtcDashboardPayload }) {
  const i = data.indicators;
  const items: { label: string; value: string }[] = [
    { label: "EMA 9", value: `$${fmtUsd(i.ema9)}` },
    { label: "EMA 20", value: `$${fmtUsd(i.ema20)}` },
    { label: "EMA 50", value: `$${fmtUsd(i.ema50)}` },
    { label: "EMA 100", value: `$${fmtUsd(i.ema100)}` },
    { label: "EMA 200", value: `$${fmtUsd(i.ema200)}` },
    { label: "RSI (14)", value: i.rsi14.toFixed(1) },
    { label: "Stoch RSI %K/%D", value: `${i.stochRsiK.toFixed(0)} / ${i.stochRsiD.toFixed(0)}` },
    { label: "MACD", value: i.macd.toFixed(1) },
    { label: "ADX (14)", value: i.adx14.toFixed(1) },
    { label: "DI+ / DI-", value: `${i.diPlus.toFixed(1)} / ${i.diMinus.toFixed(1)}` },
    { label: "ATR (14)", value: fmtUsd(i.atr14) },
    { label: "VWAP", value: `$${fmtUsd(i.vwap)}` },
    { label: "BB superior", value: `$${fmtUsd(i.bbUpper)}` },
    { label: "BB inferior", value: `$${fmtUsd(i.bbLower)}` },
    { label: "Supertrend", value: `$${fmtUsd(i.supertrendValue)}` },
    { label: "Parabolic SAR", value: `$${fmtUsd(i.parabolicSar)}` },
    { label: "Ichimoku Tenkan/Kijun", value: `${fmtUsd(i.ichimoku.tenkan, 0)} / ${fmtUsd(i.ichimoku.kijun, 0)}` },
    { label: "Volume Profile POC", value: `$${fmtUsd(i.volumeProfile.poc)}` },
    { label: "OBV", value: fmtCompact(i.obv) },
    { label: "Volumen (vela)", value: fmtCompact(i.lastVolume) },
  ];

  return (
    <div className="rounded-xl border border-edge bg-surface/70 p-5">
      <p className="text-xs uppercase tracking-[0.18em] text-ink-500 mb-3">Indicadores técnicos</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {items.map((it) => (
          <div key={it.label} className="rounded-lg bg-surface2/60 border border-edge px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-ink-500">{it.label}</p>
            <p className="font-mono tabular text-sm text-ink-100">{it.value}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-ink-500">
        Ichimoku se muestra sin desplazamiento de 26 periodos (valor actual de Tenkan/Kijun) para
        simplificar el cálculo de score; el gráfico tampoco dibuja la nube sombreada.
      </p>
    </div>
  );
}

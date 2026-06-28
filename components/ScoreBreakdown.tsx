"use client";

import { MaestroScore } from "@/lib/types";
import { fmtUsd } from "@/lib/format";

const VERDICT_STYLES: Record<MaestroScore["verdict"], string> = {
  COMPRAR: "text-bull border-bull/40 bg-bull-dim/30",
  VENDER: "text-bear border-bear/40 bg-bear-dim/30",
  NO_OPERAR: "text-ink-300 border-edge bg-surface2/60",
};

const VERDICT_LABEL: Record<MaestroScore["verdict"], string> = {
  COMPRAR: "COMPRAR",
  VENDER: "VENDER",
  NO_OPERAR: "NO OPERAR",
};

const DIR_BAR_COLOR: Record<string, string> = {
  bullish: "bg-bull",
  bearish: "bg-bear",
  neutral: "bg-ink-500/50",
};

const RADIUS = 80;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function ScoreBreakdown({ maestro }: { maestro: MaestroScore }) {
  const pct = Math.min(100, Math.max(0, maestro.total));
  const arcColor =
    maestro.direction === "bullish" ? "#2DD4A7" : maestro.direction === "bearish" ? "#F4495C" : "#F7931A";
  const dashOffset = CIRCUMFERENCE * (1 - pct / 100);
  const thresholdAngle = (maestro.threshold / 100) * 360 - 90;

  return (
    <div className="rounded-xl border border-edge bg-surface/70 p-5">
      <div className="flex flex-col sm:flex-row items-center gap-6">
        <div className="relative h-44 w-44 shrink-0">
          <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90">
            <circle cx="100" cy="100" r={RADIUS} stroke="currentColor" strokeWidth="14" fill="none" className="text-edge" />
            <circle
              cx="100"
              cy="100"
              r={RADIUS}
              stroke={arcColor}
              strokeWidth="14"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              style={{ transition: "stroke-dashoffset 0.4s ease" }}
            />
          </svg>
          {/* threshold tick at 85/100 */}
          <div
            className="absolute left-1/2 top-1/2 h-[88px] w-0.5 bg-ink-100/70 origin-top"
            style={{ transform: `rotate(${thresholdAngle}deg) translateY(0)` }}
            title="Umbral 85/100"
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-4xl tabular text-ink-100">{Math.round(maestro.total)}</span>
            <span className="text-xs text-ink-500">/100</span>
          </div>
        </div>

        <div className="flex-1 w-full">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <p className="text-xs uppercase tracking-[0.18em] text-ink-500">
              Prompt Maestro — Score ponderado
            </p>
            <span className={`px-3 py-1.5 rounded-md border font-mono text-sm tracking-wide ${VERDICT_STYLES[maestro.verdict]}`}>
              {VERDICT_LABEL[maestro.verdict]}
            </span>
          </div>

          <div className="space-y-2">
            {maestro.categories.map((cat) => (
              <div key={cat.id} className="flex items-center gap-2">
                <span className="text-xs text-ink-300 w-40 shrink-0 truncate">{cat.label}</span>
                <div className="flex-1 h-2 rounded-full bg-surface2 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${DIR_BAR_COLOR[cat.direction]}`}
                    style={{ width: `${Math.min(100, (cat.points / cat.max) * 100)}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-ink-500 w-14 text-right tabular">
                  {cat.points.toFixed(1)}/{cat.max}
                </span>
              </div>
            ))}
          </div>

          <p className="mt-3 text-xs text-ink-500">
            Regla: solo hay señal de COMPRAR/VENDER con score ≥ {maestro.threshold}/100 en una dirección
            clara. En cualquier otro caso: NO OPERAR.
          </p>
        </div>
      </div>

      {maestro.verdict !== "NO_OPERAR" && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <RiskStat label="Stop Loss" value={maestro.stopLoss ? `$${fmtUsd(maestro.stopLoss)}` : "—"} tone="bear" />
          <RiskStat label="Take Profit 1" value={maestro.takeProfit1 ? `$${fmtUsd(maestro.takeProfit1)}` : "—"} tone="bull" />
          <RiskStat label="Take Profit 2" value={maestro.takeProfit2 ? `$${fmtUsd(maestro.takeProfit2)}` : "—"} tone="bull" />
          <RiskStat label="Take Profit 3" value={maestro.takeProfit3 ? `$${fmtUsd(maestro.takeProfit3)}` : "—"} tone="bull" />
        </div>
      )}
    </div>
  );
}

function RiskStat({
  label,
  value,
  tone,
  hidden,
}: {
  label: string;
  value: string;
  tone?: "bull" | "bear";
  hidden?: boolean;
}) {
  if (hidden) return null;
  return (
    <div className="rounded-lg bg-surface2/60 border border-edge px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-ink-500">{label}</p>
      <p className={`font-mono tabular text-sm ${tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-ink-100"}`}>
        {value}
      </p>
    </div>
  );
}

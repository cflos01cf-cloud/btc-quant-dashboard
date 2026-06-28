"use client";

import { useEffect, useRef, useState } from "react";
import PriceHeader from "@/components/PriceHeader";
import ScoreBreakdown from "@/components/ScoreBreakdown";
import CandleChart from "@/components/CandleChart";
import SmcPanel from "@/components/SmcPanel";
import IndicatorGrid from "@/components/IndicatorGrid";
import DerivativesPanel from "@/components/DerivativesPanel";
import SentimentPanel from "@/components/SentimentPanel";
import TimeframeSelector from "@/components/TimeframeSelector";
import Watchlist from "@/components/Watchlist";
import JournalPanel from "@/components/JournalPanel";
import Footer from "@/components/Footer";
import { BtcDashboardPayload } from "@/lib/types";

const POLL_MS = 20_000;

const TABS = [
  { id: "resumen", label: "Resumen" },
  { id: "indicadores", label: "Indicadores & Smart Money" },
  { id: "derivados", label: "Derivados & Sentimiento" },
  { id: "watchlist", label: "Watchlist" },
  { id: "bitacora", label: "Bitácora" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function Page() {
  const [mode, setMode] = useState<"live" | "demo">("live");
  const [interval, setInterval_] = useState("15m");
  const [data, setData] = useState<BtcDashboardPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState<TabId>("resumen");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchData(currentMode: "live" | "demo", currentInterval: string) {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/btc?mode=${currentMode}&interval=${currentInterval}`, {
        cache: "no-store",
      });
      const json: BtcDashboardPayload = await res.json();
      setData(json);
    } catch {
      // Keep last good data on screen rather than wiping the dashboard.
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchData(mode, interval);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => fetchData(mode, interval), POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, interval]);

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <header className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-bitcoin font-mono text-xs uppercase tracking-[0.25em]">
            Prompt Maestro · BTC Edition
          </p>
          <h1 className="text-2xl sm:text-3xl font-semibold mt-1 text-ink-100">
            BTC Quant Dashboard Pro
          </h1>
        </div>
        <TimeframeSelector value={interval} onChange={setInterval_} />
      </header>

      <div className="space-y-5">
        <PriceHeader data={data} mode={mode} onModeChange={setMode} isLoading={isLoading} />

        {data && (
          <>
            <ScoreBreakdown maestro={data.maestro} />

            <nav className="flex gap-1 overflow-x-auto rounded-lg border border-edge bg-surface p-1">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`whitespace-nowrap px-3 py-1.5 rounded text-sm transition-colors ${
                    tab === t.id ? "bg-bitcoin text-[#1A1306]" : "text-ink-300 hover:text-ink-100"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>

            {tab === "resumen" && <CandleChart candles={data.candles} indicators={data.indicators} />}

            {tab === "indicadores" && (
              <div className="grid lg:grid-cols-2 gap-5">
                <IndicatorGrid data={data} />
                <SmcPanel events={data.smcEvents} whales={data.whales} />
              </div>
            )}

            {tab === "derivados" && (
              <div className="grid lg:grid-cols-2 gap-5">
                <DerivativesPanel data={data.derivatives} />
                <SentimentPanel fearGreed={data.fearGreed} news={data.news} />
              </div>
            )}

            {tab === "watchlist" && <Watchlist />}

            {tab === "bitacora" && (
              <JournalPanel currentPrice={data.indicators.price} currentScore={data.maestro.total} />
            )}
          </>
        )}

        {!data && isLoading && (
          <div className="rounded-xl border border-edge bg-surface/70 p-10 text-center text-ink-500 font-mono text-sm">
            Cargando datos de mercado…
          </div>
        )}
      </div>

      <Footer />
    </main>
  );
}

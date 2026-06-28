"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { WatchlistTicker } from "@/lib/types";
import { fmtPct, fmtUsd } from "@/lib/format";

const STORAGE_KEY = "btc-dashboard-watchlist";
const DEFAULT_SYMBOLS = ["ETHUSDT", "SOLUSDT", "BNBUSDT"];
const POLL_MS = 25_000;

export default function Watchlist() {
  const [symbols, setSymbols] = useState<string[]>(DEFAULT_SYMBOLS);
  const [tickers, setTickers] = useState<WatchlistTicker[]>([]);
  const [input, setInput] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setSymbols(JSON.parse(stored));
    } catch {
      /* ignore malformed storage */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols));
    } catch {
      /* private mode / storage full — watchlist just won't persist */
    }
  }, [symbols]);

  async function fetchTickers() {
    if (symbols.length === 0) {
      setTickers([]);
      return;
    }
    try {
      const res = await fetch(`/api/watchlist?symbols=${symbols.join(",")}`, { cache: "no-store" });
      const json = await res.json();
      setTickers(json.tickers ?? []);
    } catch {
      /* keep last good data on screen */
    }
  }

  useEffect(() => {
    fetchTickers();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(fetchTickers, POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols]);

  function addSymbol() {
    const sym = input.trim().toUpperCase();
    if (!sym) return;
    const withSuffix = sym.endsWith("USDT") ? sym : `${sym}USDT`;
    if (!symbols.includes(withSuffix)) setSymbols([...symbols, withSuffix]);
    setInput("");
  }

  function removeSymbol(sym: string) {
    setSymbols(symbols.filter((s) => s !== sym));
  }

  return (
    <div className="rounded-xl border border-edge bg-surface/70 p-5">
      <p className="text-xs uppercase tracking-[0.18em] text-ink-500 mb-3">Watchlist</p>

      <div className="flex gap-2 mb-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addSymbol()}
          placeholder="Agregar símbolo (ej. ADA)"
          className="flex-1 rounded-lg border border-edge bg-surface2/60 px-3 py-1.5 text-sm text-ink-100 placeholder:text-ink-500 focus:outline-none focus:border-bitcoin/50"
        />
        <button
          onClick={addSymbol}
          className="rounded-lg border border-edge bg-surface2/60 px-3 hover:border-bitcoin/50 text-ink-300 hover:text-bitcoin transition-colors"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-1.5">
        {symbols.length === 0 && (
          <p className="text-sm text-ink-500 italic">Sin símbolos en la watchlist.</p>
        )}
        {symbols.map((sym) => {
          const t = tickers.find((tk) => tk.symbol === sym);
          const positive = (t?.changePct24h ?? 0) >= 0;
          return (
            <div
              key={sym}
              className="flex items-center justify-between rounded-lg bg-surface2/50 border border-edge px-3 py-2"
            >
              <span className="font-mono text-sm text-ink-100">{sym.replace("USDT", "")}</span>
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm tabular text-ink-100">
                  {t ? `$${fmtUsd(t.price)}` : "—"}
                </span>
                <span className={`font-mono text-xs tabular ${positive ? "text-bull" : "text-bear"}`}>
                  {t ? fmtPct(t.changePct24h) : "—"}
                </span>
                <button onClick={() => removeSymbol(sym)} className="text-ink-500 hover:text-bear">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-ink-500">
        Se guarda solo en este navegador (localStorage), sin sincronizar entre dispositivos.
      </p>
    </div>
  );
}

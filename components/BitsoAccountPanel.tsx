"use client";

import { useEffect, useState } from "react";
import { fmtUsd, timeAgo } from "@/lib/format";

interface AccountData {
  ok: boolean;
  fetchedAt: number;
  balance: { btc: number; mxn: number } | null;
  ticker: {
    lastPrice: number | null;
    bid: number | null;
    ask: number | null;
    spread: number | null;
    volume24h: number | null;
  };
  portfolio: {
    btcValueMxn: number | null;
    totalMxn: number | null;
  };
  recentTrades: {
    tid: string;
    side: "buy" | "sell";
    price: number;
    amount: number;
    feesAmount: number;
    createdAt: number;
  }[];
  error?: string;
}

export default function BitsoAccountPanel() {
  const [data, setData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/bitso-account")
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-edge bg-surface/70 p-8 text-center text-ink-500 font-mono text-sm">
        Cargando cuenta Bitso…
      </div>
    );
  }

  if (!data?.ok || !data.balance) {
    return (
      <div className="rounded-xl border border-edge bg-surface/70 p-5">
        <p className="text-xs uppercase tracking-[0.18em] text-ink-500 mb-2">
          Cuenta Bitso (solo lectura)
        </p>
        <p className="text-sm text-bear">
          {data?.error ?? "No se pudo conectar a la API privada de Bitso. Verifica que BITSO_API_KEY y BITSO_API_SECRET estén configuradas en Netlify."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Balance */}
      <div className="rounded-xl border border-edge bg-surface/70 p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs uppercase tracking-[0.18em] text-ink-500">
            Cuenta Bitso — Balance disponible
          </p>
          <span className="text-[11px] text-ink-500 font-mono">
            {timeAgo(data.fetchedAt)}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            label="BTC disponible"
            value={`₿ ${data.balance.btc.toFixed(8)}`}
          />
          <StatCard
            label="MXN disponible"
            value={`$${fmtUsd(data.balance.mxn, 2)} MXN`}
          />
          <StatCard
            label="Valor BTC en MXN"
            value={
              data.portfolio.btcValueMxn !== null
                ? `$${fmtUsd(data.portfolio.btcValueMxn, 2)} MXN`
                : "—"
            }
          />
          <StatCard
            label="Total portafolio MXN"
            value={
              data.portfolio.totalMxn !== null
                ? `$${fmtUsd(data.portfolio.totalMxn, 2)} MXN`
                : "—"
            }
            highlight
          />
        </div>
      </div>

      {/* Ticker */}
      <div className="rounded-xl border border-edge bg-surface/70 p-5">
        <p className="text-xs uppercase tracking-[0.18em] text-ink-500 mb-3">
          BTC/MXN — Mercado en vivo
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            label="Último precio"
            value={
              data.ticker.lastPrice
                ? `$${fmtUsd(data.ticker.lastPrice, 2)}`
                : "—"
            }
          />
          <StatCard
            label="Bid"
            value={data.ticker.bid ? `$${fmtUsd(data.ticker.bid, 2)}` : "—"}
          />
          <StatCard
            label="Ask"
            value={data.ticker.ask ? `$${fmtUsd(data.ticker.ask, 2)}` : "—"}
          />
          <StatCard
            label="Spread"
            value={
              data.ticker.spread !== null
                ? `$${fmtUsd(data.ticker.spread, 2)}`
                : "—"
            }
          />
        </div>
      </div>

      {/* Recent trades */}
      {data.recentTrades.length > 0 && (
        <div className="rounded-xl border border-edge bg-surface/70 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-ink-500 mb-3">
            Últimas operaciones en Bitso (solo lectura)
          </p>
          <div className="space-y-1.5">
            {data.recentTrades.map((t) => (
              <div
                key={t.tid}
                className="flex items-center gap-3 rounded-lg bg-surface2/40 border border-edge px-3 py-2 text-xs"
              >
                <span
                  className={`font-mono px-1.5 py-0.5 rounded ${
                    t.side === "buy"
                      ? "text-bull bg-bull-dim/30"
                      : "text-bear bg-bear-dim/30"
                  }`}
                >
                  {t.side === "buy" ? "COMPRA" : "VENTA"}
                </span>
                <span className="font-mono text-ink-100">
                  {Math.abs(t.amount).toFixed(6)} BTC
                </span>
                <span className="font-mono text-ink-500">
                  @ ${fmtUsd(t.price, 2)} MXN
                </span>
                <span className="font-mono text-ink-500 ml-auto">
                  {timeAgo(t.createdAt)}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-ink-500">
            Historial de solo lectura — ninguna operación se ejecuta desde este
            dashboard en esta fase.
          </p>
        </div>
      )}

      {data.recentTrades.length === 0 && (
        <div className="rounded-xl border border-edge bg-surface/70 p-4 text-center text-ink-500 text-sm">
          Sin operaciones recientes en Bitso.
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        highlight
          ? "border-bitcoin/40 bg-bitcoin/10"
          : "border-edge bg-surface2/60"
      }`}
    >
      <p className="text-[11px] uppercase tracking-wide text-ink-500">
        {label}
      </p>
      <p
        className={`font-mono tabular text-sm ${
          highlight ? "text-bitcoin" : "text-ink-100"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

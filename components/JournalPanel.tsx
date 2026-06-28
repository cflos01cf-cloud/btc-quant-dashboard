"use client";

import { useEffect, useState } from "react";
import { Download, Plus, Trash2 } from "lucide-react";
import { JournalEntry } from "@/lib/types";
import { fmtUsd } from "@/lib/format";

const STORAGE_KEY = "btc-dashboard-journal";

function loadEntries(): JournalEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveEntries(entries: JournalEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* private mode / storage full — entries just won't persist */
  }
}

function pnl(entry: JournalEntry): number | null {
  if (entry.exitPrice === null) return null;
  const diff = entry.side === "LONG" ? entry.exitPrice - entry.entryPrice : entry.entryPrice - entry.exitPrice;
  return diff * entry.size;
}

export default function JournalPanel({
  currentPrice,
  currentScore,
}: {
  currentPrice: number | null;
  currentScore: number | null;
}) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    side: "LONG" as "LONG" | "SHORT",
    entryPrice: "",
    exitPrice: "",
    size: "0.01",
    stopLoss: "",
    takeProfit: "",
    notes: "",
  });

  useEffect(() => {
    setEntries(loadEntries());
  }, []);

  function openFormPrefilled() {
    setForm((f) => ({ ...f, entryPrice: currentPrice ? currentPrice.toFixed(2) : f.entryPrice }));
    setShowForm(true);
  }

  function addEntry() {
    const entryPrice = parseFloat(form.entryPrice);
    if (!Number.isFinite(entryPrice)) return;
    const newEntry: JournalEntry = {
      id: `${Date.now()}`,
      createdAt: Date.now(),
      side: form.side,
      entryPrice,
      exitPrice: form.exitPrice ? parseFloat(form.exitPrice) : null,
      size: parseFloat(form.size) || 0.01,
      stopLoss: form.stopLoss ? parseFloat(form.stopLoss) : null,
      takeProfit: form.takeProfit ? parseFloat(form.takeProfit) : null,
      notes: form.notes,
      maestroScoreAtEntry: currentScore,
    };
    const next = [newEntry, ...entries];
    setEntries(next);
    saveEntries(next);
    setShowForm(false);
    setForm({ side: "LONG", entryPrice: "", exitPrice: "", size: "0.01", stopLoss: "", takeProfit: "", notes: "" });
  }

  function removeEntry(id: string) {
    const next = entries.filter((e) => e.id !== id);
    setEntries(next);
    saveEntries(next);
  }

  async function exportToExcel() {
    const XLSX = await import("xlsx");
    const rows = entries.map((e) => ({
      Fecha: new Date(e.createdAt).toLocaleString("es-MX"),
      Lado: e.side,
      "Precio entrada": e.entryPrice,
      "Precio salida": e.exitPrice ?? "",
      "Tamaño (BTC)": e.size,
      "Stop Loss": e.stopLoss ?? "",
      "Take Profit": e.takeProfit ?? "",
      "PnL (USD)": pnl(e) ?? "",
      "Score Maestro al entrar": e.maestroScoreAtEntry ?? "",
      Notas: e.notes,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Bitácora BTC");
    XLSX.writeFile(wb, `bitacora-btc-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const closed = entries.filter((e) => e.exitPrice !== null);
  const wins = closed.filter((e) => (pnl(e) ?? 0) > 0);
  const totalPnl = closed.reduce((s, e) => s + (pnl(e) ?? 0), 0);
  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : null;

  return (
    <div className="rounded-xl border border-edge bg-surface/70 p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <p className="text-xs uppercase tracking-[0.18em] text-ink-500">Bitácora de operaciones (paper trading)</p>
        <div className="flex gap-2">
          <button
            onClick={openFormPrefilled}
            className="flex items-center gap-1.5 rounded-lg border border-edge bg-surface2/60 px-3 py-1.5 text-xs text-ink-300 hover:text-bitcoin hover:border-bitcoin/50 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Registrar trade
          </button>
          <button
            onClick={exportToExcel}
            disabled={entries.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-edge bg-surface2/60 px-3 py-1.5 text-xs text-ink-300 hover:text-bull hover:border-bull/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="h-3.5 w-3.5" /> Exportar a Excel
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <MiniStat label="Operaciones cerradas" value={`${closed.length}`} />
        <MiniStat label="Win rate" value={winRate !== null ? `${winRate.toFixed(0)}%` : "—"} />
        <MiniStat
          label="PnL total"
          value={`${totalPnl >= 0 ? "+" : ""}$${fmtUsd(totalPnl)}`}
          tone={totalPnl >= 0 ? "bull" : "bear"}
        />
      </div>

      {showForm && (
        <div className="rounded-lg border border-edge bg-surface2/50 p-3 mb-4 space-y-2">
          <div className="flex gap-2">
            <select
              value={form.side}
              onChange={(e) => setForm({ ...form, side: e.target.value as "LONG" | "SHORT" })}
              className="rounded-lg border border-edge bg-surface px-2 py-1.5 text-sm text-ink-100"
            >
              <option value="LONG">LONG</option>
              <option value="SHORT">SHORT</option>
            </select>
            <input
              placeholder="Precio entrada"
              value={form.entryPrice}
              onChange={(e) => setForm({ ...form, entryPrice: e.target.value })}
              className="flex-1 rounded-lg border border-edge bg-surface px-2 py-1.5 text-sm text-ink-100 placeholder:text-ink-500"
            />
            <input
              placeholder="Tamaño BTC"
              value={form.size}
              onChange={(e) => setForm({ ...form, size: e.target.value })}
              className="w-28 rounded-lg border border-edge bg-surface px-2 py-1.5 text-sm text-ink-100 placeholder:text-ink-500"
            />
          </div>
          <div className="flex gap-2">
            <input
              placeholder="Stop Loss"
              value={form.stopLoss}
              onChange={(e) => setForm({ ...form, stopLoss: e.target.value })}
              className="flex-1 rounded-lg border border-edge bg-surface px-2 py-1.5 text-sm text-ink-100 placeholder:text-ink-500"
            />
            <input
              placeholder="Take Profit"
              value={form.takeProfit}
              onChange={(e) => setForm({ ...form, takeProfit: e.target.value })}
              className="flex-1 rounded-lg border border-edge bg-surface px-2 py-1.5 text-sm text-ink-100 placeholder:text-ink-500"
            />
            <input
              placeholder="Precio salida (si ya cerró)"
              value={form.exitPrice}
              onChange={(e) => setForm({ ...form, exitPrice: e.target.value })}
              className="flex-1 rounded-lg border border-edge bg-surface px-2 py-1.5 text-sm text-ink-100 placeholder:text-ink-500"
            />
          </div>
          <input
            placeholder="Notas (setup, razón de entrada...)"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="w-full rounded-lg border border-edge bg-surface px-2 py-1.5 text-sm text-ink-100 placeholder:text-ink-500"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="text-xs text-ink-500 px-3 py-1.5">
              Cancelar
            </button>
            <button
              onClick={addEntry}
              className="text-xs bg-bitcoin text-[#1A1306] rounded-lg px-3 py-1.5 font-medium"
            >
              Guardar
            </button>
          </div>
        </div>
      )}

      <div className="space-y-1.5 max-h-80 overflow-y-auto">
        {entries.length === 0 && <p className="text-sm text-ink-500 italic">Sin operaciones registradas todavía.</p>}
        {entries.map((e) => {
          const p = pnl(e);
          return (
            <div key={e.id} className="flex items-center justify-between rounded-lg bg-surface2/40 border border-edge px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${e.side === "LONG" ? "text-bull bg-bull-dim/30" : "text-bear bg-bear-dim/30"}`}>
                  {e.side}
                </span>
                <span className="text-sm text-ink-100 font-mono tabular truncate">
                  ${fmtUsd(e.entryPrice)} {e.exitPrice ? `→ $${fmtUsd(e.exitPrice)}` : "(abierta)"}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {p !== null && (
                  <span className={`text-xs font-mono tabular ${p >= 0 ? "text-bull" : "text-bear"}`}>
                    {p >= 0 ? "+" : ""}${fmtUsd(p)}
                  </span>
                )}
                <button onClick={() => removeEntry(e.id)} className="text-ink-500 hover:text-bear">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-ink-500">
        Bitácora de papel (simulada), guardada solo en este navegador. No ejecuta operaciones reales.
      </p>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" }) {
  return (
    <div className="rounded-lg bg-surface2/60 border border-edge px-3 py-2 text-center">
      <p className="text-[10px] uppercase tracking-wide text-ink-500">{label}</p>
      <p className={`font-mono tabular text-sm ${tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-ink-100"}`}>
        {value}
      </p>
    </div>
  );
}

import type { Config } from "@netlify/functions";
import { getBitsoTicker } from "../../lib/bitso";
import { getCandlesRange } from "../../lib/marketdata";
import { listOpenSignals, updateSignalStatus } from "../../lib/blobstore";
import { recorrerTrayectoria } from "../../lib/trayectoria";
import { SignalRecord, SignalStatus } from "../../lib/types";

/**
 * Corre cada hora y evalúa las alertas abiertas.
 *
 * COINBASE: se recorre la trayectoria completa en velas de 5 minutos desde
 * la entrada (lib/trayectoria.ts). Como mira todas las velas transcurridas,
 * correr cada hora no hace perder ningún toque de stop u objetivo: lo que
 * pasó entre revisiones se recupera de las velas.
 *
 * BITSO: sigue con la evaluación por ticker. Bitso no ofrece velas
 * históricas confiables en su API pública (las velas de lib/bitso.ts se
 * arman con un caché de trades que se pierde en cada arranque en frío), así
 * que no hay trayectoria que recorrer. Sus resultados siguen siendo
 * aproximados y no deben mezclarse con los de Coinbase al sacar
 * conclusiones.
 */

const M5_MS = 5 * 60_000;

async function evaluarCoinbase(s: SignalRecord) {
  const ahora = Date.now();
  const velas = await getCandlesRange(300, s.createdAt - M5_MS, Math.min(ahora, s.expiresAt));
  return recorrerTrayectoria(s, velas, M5_MS, ahora);
}

async function evaluarBitso(s: SignalRecord) {
  const ticker = await getBitsoTicker();
  if (ticker.lastPrice === null) return null;
  const lado = s.direction === "bullish" ? 1 : -1;
  const mov = (lado * (ticker.lastPrice - s.priceReference) / s.priceReference) * 100;
  const ahora = Date.now();

  let status: SignalStatus = "open";
  if (ahora >= s.expiresAt) status = "expired";
  else if (mov <= -Math.abs(s.stopLossPct)) status = "sl_hit";
  else if (mov >= Math.abs(s.tp3Pct)) status = "tp3_hit";
  else if (mov >= Math.abs(s.tp2Pct)) status = "tp2_hit";
  else if (mov >= Math.abs(s.tp1Pct)) status = "tp1_hit";

  return {
    status,
    closePricePct: status === "open" ? null : mov,
    closedAt: status === "open" ? null : ahora,
    // Sin trayectoria no hay excursiones reales; se conserva lo que ya tenía.
    mfePct: Math.max(s.mfePct ?? 0, mov > 0 ? mov : 0),
    maePct: Math.max(s.maePct ?? 0, mov < 0 ? -mov : 0),
  };
}

export default async () => {
  const resultados: { id: string; source: string; nuevo: string; pct: number | null }[] = [];
  const errores: string[] = [];

  try {
    const [cb, bi] = await Promise.all([listOpenSignals("coinbase"), listOpenSignals("bitso")]);

    for (const s of [...cb, ...bi]) {
      try {
        const ev = s.source === "coinbase" ? await evaluarCoinbase(s) : await evaluarBitso(s);
        if (!ev) continue;

        if (ev.status === "open") {
          // Sigue abierta: solo se actualizan las excursiones reales.
          await updateSignalStatus(s.source, s.id, { mfePct: ev.mfePct, maePct: ev.maePct });
          continue;
        }

        await updateSignalStatus(s.source, s.id, {
          status: ev.status,
          closedAt: ev.closedAt,
          closePricePct: ev.closePricePct,
          mfePct: ev.mfePct,
          maePct: ev.maePct,
        });
        resultados.push({ id: s.id, source: s.source, nuevo: ev.status, pct: ev.closePricePct });
      } catch (e: any) {
        // Una alerta con error no debe impedir evaluar las demás.
        errores.push(`${s.id}: ${e?.message ?? e}`);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, evaluadas: cb.length + bi.length, cerradas: resultados, errores }),
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[outcome-evaluator] error:", err?.message);
    return new Response(JSON.stringify({ ok: false, error: err?.message }), { status: 200 });
  }
};

export const config: Config = {
  schedule: "0 * * * *",
};

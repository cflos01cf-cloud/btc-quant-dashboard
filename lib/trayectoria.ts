import { Candle, SignalRecord, SignalStatus } from "./types";

/**
 * Evalúa una alerta recorriendo la trayectoria real del precio, vela por vela.
 *
 * Reemplaza a la evaluación anterior, que miraba una sola cosa por hora: el
 * cierre de la última vela de 1h. Eso tenía tres defectos que se midieron en
 * el análisis de noviembre (9 de 44 alertas con resultado distinto al real):
 *   - no veía toques de stop u objetivo dentro de la hora;
 *   - cerraba al precio del momento de la revisión, no al nivel tocado;
 *   - su MFE/MAE era una copia del movimiento al cierre, no el máximo y el
 *     mínimo reales.
 *
 * Reglas:
 *   - Solo cuentan velas que ABREN en o después de la alerta. La vela que la
 *     contiene tiene parte de su rango antes de la entrada.
 *   - Si una vela toca stop y objetivo a la vez, se asume stop primero. Con
 *     velas de 5 minutos no se sabe el orden, y asumir el objetivo sería
 *     regalarse resultado.
 *   - Stop y objetivo cierran al NIVEL tocado. Al vencer, se cierra al cierre
 *     de la última vela antes del vencimiento.
 *
 * Función pura: sin red ni base de datos, para poder probarla aislada.
 */
export interface Evaluacion {
  status: SignalStatus;
  closePricePct: number | null; // % a favor de la dirección; null si sigue abierta
  closedAt: number | null;
  mfePct: number; // máxima excursión a favor, %
  maePct: number; // máxima excursión en contra, % (positivo)
}

export function recorrerTrayectoria(
  s: SignalRecord,
  velas: Candle[],
  periodoMs: number,
  ahora: number
): Evaluacion {
  const lado = s.direction === "bullish" ? 1 : -1;
  const e = s.priceReference;
  const sl = Math.abs(s.stopLossPct);
  const tps = [Math.abs(s.tp1Pct), Math.abs(s.tp2Pct), Math.abs(s.tp3Pct)];
  const estadosTp: SignalStatus[] = ["tp1_hit", "tp2_hit", "tp3_hit"];

  let mfe = 0;
  let mae = 0;
  let ultimoCierre: { pct: number; t: number } | null = null;

  for (const v of velas) {
    if (v.time < s.createdAt) continue;
    if (v.time >= s.expiresAt) break;

    // Movimientos de la vela a favor y en contra de la dirección, en %
    const fav = lado === 1 ? ((v.high - e) / e) * 100 : ((e - v.low) / e) * 100;
    const adv = lado === 1 ? ((e - v.low) / e) * 100 : ((v.high - e) / e) * 100;
    const finVela = v.time + periodoMs;

    if (adv >= sl) {
      return {
        status: "sl_hit",
        closePricePct: -sl,
        closedAt: finVela,
        mfePct: mfe, // la vela del stop no cuenta: no se sabe si llegó antes o después
        maePct: Math.max(mae, sl),
      };
    }

    mfe = Math.max(mfe, fav);
    mae = Math.max(mae, adv);

    // El objetivo más alto alcanzado en esta vela
    let nivel = -1;
    for (let k = tps.length - 1; k >= 0; k--) {
      if (fav >= tps[k]) {
        nivel = k;
        break;
      }
    }
    if (nivel >= 0) {
      return {
        status: estadosTp[nivel],
        closePricePct: tps[nivel],
        closedAt: finVela,
        mfePct: mfe,
        maePct: mae,
      };
    }

    ultimoCierre = { pct: (lado * (v.close - e) / e) * 100, t: finVela };
  }

  if (ahora >= s.expiresAt) {
    return {
      status: "expired",
      closePricePct: ultimoCierre ? ultimoCierre.pct : 0,
      closedAt: s.expiresAt,
      mfePct: mfe,
      maePct: mae,
    };
  }

  return { status: "open", closePricePct: null, closedAt: null, mfePct: mfe, maePct: mae };
}

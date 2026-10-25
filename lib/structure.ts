import { IndicatorSnapshot } from "./types";

/**
 * DETECCIÓN DE EVENTOS ESTRUCTURALES
 *
 * Canal de alertas independiente del score.
 *
 * Por qué existe: el score mide CONSENSO acumulado entre siete categorías.
 * El consenso llega tarde por construcción — se forma cuando las categorías
 * terminan de ponerse de acuerdo, que suele ser después del movimiento. Un
 * cruce de EMAs o un flip de Supertrend, en cambio, ocurre en una vela
 * concreta y fechada.
 *
 * Estos eventos NO son señales de trade. Son avisos de "cambió la estructura,
 * míralo". Van en un mensaje de Telegram separado para no contaminar el canal
 * de señales COMPRAR/VENDER.
 *
 * La detección es por CRUCE, no por estado: comparamos el estado actual
 * contra el guardado en la invocación anterior y solo emitimos cuando el
 * signo cambia. Sin eso mandaríamos el mismo aviso cada 15 minutos.
 */

export type StructureSeverity = "mayor" | "medio";

export interface StructureEvent {
  id: string;
  label: string;
  direction: "bullish" | "bearish";
  severity: StructureSeverity;
  detail: string;
}

/** Estado persistido entre invocaciones del cron para detectar cruces. */
export interface StructureState {
  supertrend: "bullish" | "bearish" | "neutral";
  ema20AboveEma50: boolean;
  priceAboveEma200: boolean;
  alignment: "alcista" | "bajista" | "mixta";
  updatedAt: number;
}

/** Lee el estado estructural actual a partir del snapshot de indicadores. */
export function readStructureState(ind: IndicatorSnapshot): StructureState {
  const ema20AboveEma50 = ind.ema20 > ind.ema50;
  const priceAboveEma200 = ind.price > ind.ema200;

  // Alineación: SOLO las tres medias entre sí, sin el precio.
  //
  // Incluir el precio parecía natural pero genera ruido: el precio cruza la
  // EMA20 varias veces por semana, así que la alineación se perdería y
  // recuperaría cada pocas horas en mercados agitados. Con solo las medias
  // es una condición de movimiento lento — cambia cuando la estructura
  // cambia de verdad. El precio contra EMA200 ya tiene su propio evento.
  const alcista = ind.ema20 > ind.ema50 && ind.ema50 > ind.ema200;
  const bajista = ind.ema20 < ind.ema50 && ind.ema50 < ind.ema200;

  return {
    supertrend: ind.supertrendDirection,
    ema20AboveEma50,
    priceAboveEma200,
    alignment: alcista ? "alcista" : bajista ? "bajista" : "mixta",
    updatedAt: Date.now(),
  };
}

/**
 * Compara el estado anterior contra el actual y devuelve solo los cruces.
 * Si no hay estado previo (primera corrida, o cold start tras un deploy)
 * devuelve vacío: no tenemos con qué comparar y mandar todo sería ruido.
 */
export function detectStructureEvents(
  prev: StructureState | null,
  curr: StructureState,
  ind: IndicatorSnapshot
): StructureEvent[] {
  if (!prev) return [];

  const events: StructureEvent[] = [];

  // 1. Flip de Supertrend — cambio de sesgo del régimen
  if (
    prev.supertrend !== curr.supertrend &&
    (curr.supertrend === "bullish" || curr.supertrend === "bearish")
  ) {
    events.push({
      id: "supertrend_flip",
      label: `Supertrend viró ${curr.supertrend === "bullish" ? "alcista" : "bajista"}`,
      direction: curr.supertrend,
      severity: "mayor",
      detail: `Banda en $${ind.supertrendValue.toFixed(0)} · precio $${ind.price.toFixed(0)}`,
    });
  }

  // 2. Cruce EMA20 / EMA50 — momentum de medio plazo
  if (prev.ema20AboveEma50 !== curr.ema20AboveEma50) {
    const alcista = curr.ema20AboveEma50;
    events.push({
      id: "ema20_50_cross",
      label: `EMA20 cruzó ${alcista ? "sobre" : "bajo"} EMA50`,
      direction: alcista ? "bullish" : "bearish",
      severity: "medio",
      detail: `EMA20 $${ind.ema20.toFixed(0)} · EMA50 $${ind.ema50.toFixed(0)}`,
    });
  }

  // 3. Precio cruza EMA200 — cambio de estructura mayor
  if (prev.priceAboveEma200 !== curr.priceAboveEma200) {
    const alcista = curr.priceAboveEma200;
    events.push({
      id: "price_ema200_cross",
      label: `Precio cruzó ${alcista ? "sobre" : "bajo"} EMA200`,
      direction: alcista ? "bullish" : "bearish",
      severity: "mayor",
      detail: `Precio $${ind.price.toFixed(0)} · EMA200 $${ind.ema200.toFixed(0)}`,
    });
  }

  // 4. Alineación completa de las tres medias (ganada o perdida)
  if (prev.alignment !== curr.alignment) {
    if (curr.alignment === "alcista" || curr.alignment === "bajista") {
      events.push({
        id: "ema_alignment_gained",
        label: `Medias alineadas en ${curr.alignment}`,
        direction: curr.alignment === "alcista" ? "bullish" : "bearish",
        severity: "mayor",
        detail:
          curr.alignment === "alcista"
            ? `EMA20 > EMA50 > EMA200`
            : `EMA20 < EMA50 < EMA200`,
      });
    } else if (prev.alignment !== "mixta") {
      events.push({
        id: "ema_alignment_lost",
        label: `Se perdió la alineación ${prev.alignment}`,
        direction: prev.alignment === "alcista" ? "bearish" : "bullish",
        severity: "medio",
        detail: `Las medias dejaron de estar ordenadas`,
      });
    }
  }

  return events;
}

/** Arma el mensaje de Telegram del canal estructural. */
export function buildStructureMessage(
  events: StructureEvent[],
  ind: IndicatorSnapshot,
  interval: string
): string {
  const mayores = events.filter((e) => e.severity === "mayor").length;
  const icono = mayores > 0 ? "🔔" : "•";

  const lineas = [
    `${icono} *Cambio de estructura* · BTC ${interval}`,
    ``,
    ...events.map((e) => {
      const flecha = e.direction === "bullish" ? "↑" : "↓";
      const marca = e.severity === "mayor" ? "*" : "";
      return `${flecha} ${marca}${e.label}${marca}\n   ${e.detail}`;
    }),
    ``,
    `Precio $${ind.price.toFixed(0)} · RSI ${ind.rsi14.toFixed(0)} · ADX ${ind.adx14.toFixed(0)}`,
    ``,
    `_Aviso de estructura, no es señal de entrada. El canal de señales COMPRAR/VENDER es aparte._`,
  ];

  return lineas.join("\n");
}

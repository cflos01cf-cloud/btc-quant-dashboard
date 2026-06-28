import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { getDerivativesSnapshot, getLiveBtcData, getWhaleSummary } from "../../lib/marketdata";
import { buildIndicatorSnapshot } from "../../lib/indicators";
import { detectSmcEvents } from "../../lib/smc";
import { getFearGreedIndex } from "../../lib/feargreed";
import { getBtcNews } from "../../lib/news";
import { computeMaestroScore } from "../../lib/score";

/**
 * Runs every 15 minutes. Recomputes the same Prompt Maestro score the
 * dashboard shows, and sends ONE consolidated Telegram alert only when the
 * verdict actually changes (e.g. NO_OPERAR -> COMPRAR, or COMPRAR -> VENDER)
 * — not on every minor indicator cross. This is intentional: the whole
 * point of the 85/100 threshold is to avoid alert fatigue and low-quality
 * signals. State is kept in Netlify Blobs so we don't need a separate
 * database just to deduplicate.
 */
export default async () => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  try {
    const base = await getLiveBtcData("15m", 300);
    const [derivatives, whales, fearGreed, news] = await Promise.all([
      getDerivativesSnapshot().catch(() => ({
        fundingRate: null,
        markPrice: null,
        openInterest: null,
        openInterestChangePct: null,
        longShortRatio: null,
      })),
      getWhaleSummary().catch(() => ({
        windowMinutes: 30,
        largeTradeThresholdUsd: 250_000,
        buyVolume: 0,
        sellVolume: 0,
        netDirection: "neutral" as const,
        tradeCount: 0,
      })),
      getFearGreedIndex().catch(() => null),
      getBtcNews(8).catch(() => []),
    ]);

    const indicators = buildIndicatorSnapshot(base.candles);
    const smcEvents = detectSmcEvents(base.candles);
    const maestro = computeMaestroScore({
      indicators,
      candles: base.candles,
      orderBook: base.orderBook,
      smcEvents,
      whales,
      derivatives,
      fearGreed,
      news,
    });

    const store = getStore({ name: "btc-alerts" });
    const previousRaw = await store.get("last-alert", { type: "json" }).catch(() => null);
    const previousVerdict = (previousRaw as any)?.verdict ?? "NO_OPERAR";

    const verdictChanged = maestro.verdict !== previousVerdict;
    const shouldAlert = verdictChanged && maestro.verdict !== "NO_OPERAR";

    await store.setJSON("last-alert", { verdict: maestro.verdict, timestamp: Date.now(), score: maestro.total });

    if (!shouldAlert) {
      return new Response(
        JSON.stringify({ ok: true, alerted: false, verdict: maestro.verdict, score: maestro.total }),
        { status: 200 }
      );
    }

    if (!botToken || !chatId) {
      console.log("[scheduled-alert] Señal nueva pero TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID no configurados:", maestro.verdict);
      return new Response(JSON.stringify({ ok: true, alerted: false, reason: "missing-telegram-config" }), {
        status: 200,
      });
    }

    const price = indicators.price;
    const lines = [
      `*BTC Quant Dashboard Pro*`,
      `Señal: *${maestro.verdict}*  (score ${maestro.total.toFixed(0)}/100)`,
      `Precio: $${price.toFixed(2)}`,
      maestro.stopLoss ? `Stop Loss: $${maestro.stopLoss.toFixed(2)}` : null,
      maestro.takeProfit1 ? `TP1: $${maestro.takeProfit1.toFixed(2)} · TP2: $${maestro.takeProfit2?.toFixed(2)} · TP3: $${maestro.takeProfit3?.toFixed(2)}` : null,
      `_Heurístico, no es asesoría financiera._`,
    ].filter(Boolean);

    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: lines.join("\n"),
        parse_mode: "Markdown",
      }),
    });

    return new Response(
      JSON.stringify({ ok: tgRes.ok, alerted: true, verdict: maestro.verdict, score: maestro.total }),
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[scheduled-alert] error:", err?.message);
    return new Response(JSON.stringify({ ok: false, error: err?.message }), { status: 200 });
  }
};

export const config: Config = {
  schedule: "*/15 * * * *",
};

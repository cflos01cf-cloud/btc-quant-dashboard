"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
} from "lightweight-charts";
import { Candle, IndicatorSnapshot } from "@/lib/types";
import { ema } from "@/lib/indicators";

export default function CandleChart({
  candles,
  indicators,
}: {
  candles: Candle[];
  indicators: IndicatorSnapshot;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const ema20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema200Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  // Create the chart once.
  useEffect(() => {
    if (!containerRef.current) return;

    const isLight = document.documentElement.classList.contains("light");
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: isLight ? "#5B6270" : "#AEB6C4",
        fontFamily: "IBM Plex Mono, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: isLight ? "#E4E0D6" : "#202838" },
        horzLines: { color: isLight ? "#E4E0D6" : "#202838" },
      },
      rightPriceScale: { borderColor: isLight ? "#E4E0D6" : "#202838" },
      timeScale: { borderColor: isLight ? "#E4E0D6" : "#202838", timeVisible: true },
      crosshair: { mode: CrosshairMode.Normal },
      autoSize: true,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#2DD4A7",
      downColor: "#F4495C",
      borderVisible: false,
      wickUpColor: "#2DD4A7",
      wickDownColor: "#F4495C",
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      color: "#7C859740",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    const ema20Series = chart.addLineSeries({ color: "#2DD4A7", lineWidth: 1 });
    const ema50Series = chart.addLineSeries({ color: "#F4495C", lineWidth: 1 });
    const ema200Series = chart.addLineSeries({ color: "#F7931A", lineWidth: 2 });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeRef.current = volumeSeries;
    ema20Ref.current = ema20Series;
    ema50Ref.current = ema50Series;
    ema200Ref.current = ema200Series;

    return () => {
      chart.remove();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push data whenever candles change.
  useEffect(() => {
    if (!candleSeriesRef.current || candles.length === 0) return;

    const candleData = candles.map((c) => ({
      time: Math.floor(c.time / 1000) as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    candleSeriesRef.current.setData(candleData);

    volumeRef.current?.setData(
      candles.map((c) => ({
        time: Math.floor(c.time / 1000) as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? "#2DD4A740" : "#F4495C40",
      }))
    );

    const closes = candles.map((c) => c.close);
    const e20 = ema(closes, 20);
    const e50 = ema(closes, 50);
    const e200 = ema(closes, 200);

    ema20Ref.current?.setData(
      candles.map((c, i) => ({ time: Math.floor(c.time / 1000) as UTCTimestamp, value: e20[i] }))
    );
    ema50Ref.current?.setData(
      candles.map((c, i) => ({ time: Math.floor(c.time / 1000) as UTCTimestamp, value: e50[i] }))
    );
    ema200Ref.current?.setData(
      candles.map((c, i) => ({ time: Math.floor(c.time / 1000) as UTCTimestamp, value: e200[i] }))
    );

    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  return (
    <div className="rounded-xl border border-edge bg-surface/70 p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs uppercase tracking-[0.18em] text-ink-500">
          Gráfico · EMA20 (verde) · EMA50 (rojo) · EMA200 (naranja)
        </p>
        <p className="text-xs text-ink-500 font-mono">
          Supertrend: {indicators.supertrendDirection === "bullish" ? "↑ alcista" : "↓ bajista"}
        </p>
      </div>
      <div ref={containerRef} className="h-[420px] w-full" />
    </div>
  );
}

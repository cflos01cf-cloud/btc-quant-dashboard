"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  LineData,
  ColorType,
  CrosshairMode,
} from "lightweight-charts";
import { Candle } from "@/lib/types";

interface EmaPoint {
  time: number; // ms epoch
  value: number;
}

interface Props {
  candles: Candle[];
  indicators: {
    ema20: number;
    ema50: number;
    ema200: number;
  };
  emaSeries?: {
    ema20: EmaPoint[];
    ema50: EmaPoint[];
    ema200: EmaPoint[];
  };
}

/**
 * FIX — CandleChart now uses real EMA series data from the API instead of
 * a linear approximation. If emaSeries is provided (new API format), it draws
 * the actual computed EMA values per candle. Falls back to the approximation
 * if emaSeries is not available (backward compatibility).
 */
export default function CandleChart({ candles, indicators, emaSeries }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    const { ema20, ema50, ema200 } = indicators;
    let mounted = true;

    const chart: IChartApi = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9ca3af",
      },
      grid: {
        vertLines: { color: "#1f2937" },
        horzLines: { color: "#1f2937" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#374151" },
      timeScale: { borderColor: "#374151", timeVisible: true },
      width: containerRef.current.clientWidth,
      height: 320,
    });

    const candleSeries: ISeriesApi<"Candlestick"> = chart.addCandlestickSeries({
      upColor: "#10b981",
      downColor: "#ef4444",
      borderUpColor: "#10b981",
      borderDownColor: "#ef4444",
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
    });

    const ema20Series: ISeriesApi<"Line"> = chart.addLineSeries({
      color: "#10b981",
      lineWidth: 1,
      title: "EMA20",
    });

    const ema50Series: ISeriesApi<"Line"> = chart.addLineSeries({
      color: "#ef4444",
      lineWidth: 1,
      title: "EMA50",
    });

    const ema200Series: ISeriesApi<"Line"> = chart.addLineSeries({
      color: "#f97316",
      lineWidth: 1,
      title: "EMA200",
    });

    if (mounted) {
      const candleData: CandlestickData[] = candles.map((c) => ({
        time: Math.floor(c.time / 1000) as any,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      candleSeries.setData(candleData);

      if (emaSeries && emaSeries.ema20.length > 0) {
        // Use real EMA series from API
        ema20Series.setData(
          emaSeries.ema20.map((p) => ({ time: Math.floor(p.time / 1000) as any, value: p.value }))
        );
        ema50Series.setData(
          emaSeries.ema50.map((p) => ({ time: Math.floor(p.time / 1000) as any, value: p.value }))
        );
        ema200Series.setData(
          emaSeries.ema200.map((p) => ({ time: Math.floor(p.time / 1000) as any, value: p.value }))
        );
      } else {
        // Fallback: linear approximation (old behavior)
        const emaLine = (value: number): LineData[] =>
          candles.map((c, i) => ({
            time: Math.floor(c.time / 1000) as any,
            value: value + ((candles[i].close - value) * (i / candles.length)) * 0.1,
          }));
        ema20Series.setData(emaLine(ema20));
        ema50Series.setData(emaLine(ema50));
        ema200Series.setData(emaLine(ema200));
      }

      chart.timeScale().fitContent();
    }

    const handleResize = () => {
      if (mounted && containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      mounted = false;
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [candles, indicators, emaSeries]);

  return (
    <div
      ref={containerRef}
      className="w-full rounded-xl overflow-hidden"
      style={{ height: 320 }}
    />
  );
}

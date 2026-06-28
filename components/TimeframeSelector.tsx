"use client";

const TIMEFRAMES = [
  "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "1w", "1M",
];

export default function TimeframeSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (tf: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-edge bg-surface p-1">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf}
          onClick={() => onChange(tf)}
          className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
            value === tf ? "bg-bitcoin text-[#1A1306]" : "text-ink-300 hover:text-ink-100"
          }`}
        >
          {tf}
        </button>
      ))}
    </div>
  );
}

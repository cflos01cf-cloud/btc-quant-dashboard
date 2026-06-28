"use client";

import { ExternalLink } from "lucide-react";
import { FearGreed, NewsHeadline } from "@/lib/types";
import { timeAgo } from "@/lib/format";

const SENTIMENT_DOT = {
  bullish: "bg-bull",
  bearish: "bg-bear",
  neutral: "bg-ink-500",
};

export default function SentimentPanel({
  fearGreed,
  news,
}: {
  fearGreed: FearGreed | null;
  news: NewsHeadline[];
}) {
  const fgPct = fearGreed ? fearGreed.value : 50;
  const fgColor = fgPct <= 25 ? "#2DD4A7" : fgPct >= 75 ? "#F4495C" : "#F7931A";

  return (
    <div className="rounded-xl border border-edge bg-surface/70 p-5">
      <p className="text-xs uppercase tracking-[0.18em] text-ink-500 mb-3">Sentimiento &amp; Noticias</p>

      <div className="flex items-center gap-4 mb-4">
        <div className="flex-1">
          <div className="h-2 rounded-full bg-surface2 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${fgPct}%`, backgroundColor: fgColor }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-ink-500 mt-1">
            <span>Miedo extremo</span>
            <span>Codicia extrema</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="font-mono text-2xl tabular text-ink-100">{fgPct}</p>
          <p className="text-xs text-ink-500">{fearGreed?.classification ?? "n/d"}</p>
        </div>
      </div>

      <div className="space-y-2">
        {news.length === 0 && (
          <p className="text-sm text-ink-500 italic">Noticias no disponibles en este momento.</p>
        )}
        {news.map((n, idx) => (
          <a
            key={idx}
            href={n.link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-2 rounded-lg border border-edge bg-surface2/40 px-3 py-2 hover:border-bitcoin/40 transition-colors group"
          >
            <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${SENTIMENT_DOT[n.sentiment]}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink-100 leading-snug">{n.title}</p>
              <p className="text-[11px] text-ink-500">
                {n.source} · {timeAgo(n.publishedAt)}
              </p>
            </div>
            <ExternalLink className="h-3.5 w-3.5 text-ink-500 group-hover:text-bitcoin shrink-0 mt-0.5" />
          </a>
        ))}
      </div>
    </div>
  );
}

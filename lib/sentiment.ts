import { Direction } from "./types";

const BULLISH_WORDS = [
  "surge", "soars", "rally", "bullish", "all-time high", "record high", "breakout",
  "adoption", "approval", "approved", "inflow", "accumulat", "buy the dip", "upgrade",
  "outperform", "gain", "jumps", "rebound", "etf approval", "halving",
];

const BEARISH_WORDS = [
  "crash", "plunge", "bearish", "selloff", "sell-off", "dump", "ban", "hack", "exploit",
  "lawsuit", "outflow", "liquidat", "downgrade", "fear", "regulatory crackdown", "fraud",
  "collapse", "delist", "drops", "tumbles", "warns",
];

/**
 * Free, keyword-based sentiment classifier. This is intentionally simple
 * and transparent — it is NOT a trained NLP model, just a fast heuristic
 * so the dashboard works with zero API keys. See classifyWithClaude()
 * below for an optional, more nuanced upgrade.
 */
export function classifyHeadlineHeuristic(title: string): Direction {
  const t = title.toLowerCase();
  const bullHits = BULLISH_WORDS.filter((w) => t.includes(w)).length;
  const bearHits = BEARISH_WORDS.filter((w) => t.includes(w)).length;
  if (bullHits > bearHits) return "bullish";
  if (bearHits > bullHits) return "bearish";
  return "neutral";
}

/**
 * Optional upgrade: if ANTHROPIC_API_KEY is set in the environment, classify
 * all headlines in one call via Claude Haiku for better accuracy. Falls
 * back silently to the heuristic classifier on any error or missing key —
 * this must never block the dashboard.
 */
export async function classifyHeadlinesWithClaude(
  titles: string[]
): Promise<Direction[] | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || titles.length === 0) return null;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content:
              "Clasifica cada titular de noticia sobre Bitcoin como bullish, bearish o neutral " +
              "para el precio de BTC. Responde SOLO con un array JSON de strings, una por titular, " +
              "en el mismo orden, sin texto adicional.\n\n" +
              titles.map((t, i) => `${i + 1}. ${t}`).join("\n"),
          },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.content?.find((b: any) => b.type === "text")?.text ?? "";
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    if (!Array.isArray(parsed) || parsed.length !== titles.length) return null;
    return parsed.map((s: string) =>
      ["bullish", "bearish", "neutral"].includes(s) ? (s as Direction) : "neutral"
    );
  } catch {
    return null;
  }
}

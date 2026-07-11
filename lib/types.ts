export type Direction = "bullish" | "bearish" | "neutral";
export type Verdict = "COMPRAR" | "VENDER" | "NO_OPERAR";

export interface Candle {
  time: number; // ms epoch (close time)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ---------- Indicators ----------

export interface IndicatorSnapshot {
  price: number;
  ema9: number;
  ema20: number;
  ema50: number;
  ema100: number;
  ema200: number;
  rsi14: number;
  stochRsiK: number;
  stochRsiD: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
  vwap: number;
  bbUpper: number;
  bbMid: number;
  bbLower: number;
  atr14: number;
  atr14Avg50: number;
  adx14: number;
  diPlus: number;
  diMinus: number;
  obv: number;
  obvSlope: Direction;
  supertrendValue: number;
  supertrendDirection: Direction;
  parabolicSar: number;
  parabolicSarDirection: Direction;
  ichimoku: {
    tenkan: number;
    kijun: number;
    spanA: number;
    spanB: number;
  };
  volumeProfile: {
    poc: number; // price level with highest traded volume
    direction: Direction; // price vs POC
  };
  avgVolume20: number;
  lastVolume: number;
}

// ---------- Smart Money Concepts (heuristic) ----------

export interface SmcEvent {
  type: "BOS" | "CHOCH" | "FVG" | "LIQUIDITY_SWEEP" | "ORDER_BLOCK";
  direction: Direction;
  label: string;
  detail: string;
  price?: number;
  time?: number;
}

export interface WhaleSummary {
  windowMinutes: number;
  largeTradeThresholdUsd: number;
  buyVolume: number;
  sellVolume: number;
  netDirection: Direction;
  tradeCount: number;
}

// ---------- Derivatives ----------

export interface DerivativesSnapshot {
  fundingRate: number | null;
  markPrice: number | null;
  openInterest: number | null;
  openInterestChangePct: number | null;
  longShortRatio: number | null; // long accounts / short accounts
}

// ---------- Sentiment / News ----------

export interface FearGreed {
  value: number; // 0-100
  classification: string;
}

export interface NewsHeadline {
  title: string;
  link: string;
  publishedAt: number;
  sentiment: Direction;
  source: string;
}

// ---------- Score engine ----------

export interface ScoreCheck {
  label: string;
  weight: number;
  direction: Direction;
  detail: string;
}

export interface CategoryScore {
  id: string;
  label: string;
  points: number; // 0..max
  max: number;
  direction: Direction;
  checks: ScoreCheck[];
}

export interface MaestroScore {
  verdict: Verdict;
  direction: Direction;
  total: number; // 0-100, only counts categories agreeing with `direction`
  threshold: number;
  categories: CategoryScore[];
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  takeProfit3: number | null;
  riskRewardT1: number | null;
}

// ---------- Master payload ----------

export interface BtcDashboardPayload {
  source: "live" | "demo";
  warning?: string;
  fetchedAt: number;
  symbol: string;
  interval: string;
  resolvedInterval: string;
  priceChangePct24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  indicators: IndicatorSnapshot;
  orderBook: { bidVolume: number; askVolume: number; imbalanceRatio: number };
  smcEvents: SmcEvent[];
  whales: WhaleSummary;
  derivatives: DerivativesSnapshot;
  fearGreed: FearGreed | null;
  news: NewsHeadline[];
  maestro: MaestroScore;
  candles: Candle[];
  dataNotes: string[]; // graceful-degradation notices (e.g. "noticias no disponibles")
}

// ---------- Watchlist ----------

export interface WatchlistTicker {
  symbol: string;
  price: number;
  changePct24h: number;
}

// ---------- Paper trading journal (client-side only) ----------

export interface JournalEntry {
  id: string;
  createdAt: number;
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number | null;
  size: number; // in BTC
  stopLoss: number | null;
  takeProfit: number | null;
  notes: string;
  maestroScoreAtEntry: number | null;
}

// ---------- Shadow trading / signal outcome tracking ----------

export type SignalSource = "coinbase" | "bitso";
export type SignalStatus = "open" | "tp1_hit" | "tp2_hit" | "tp3_hit" | "sl_hit" | "expired";

export interface SignalRecord {
  id: string;                    // uuid-style: source-timestamp
  source: SignalSource;
  createdAt: number;             // ms epoch
  verdict: Verdict;              // COMPRAR | VENDER
  direction: "bullish" | "bearish";
  score: number;                 // 0-100
  priceReference: number;        // entry price in native currency (MXN for Bitso, USD for Coinbase)
  currency: "MXN" | "USD";
  stopLossPct: number;           // % below/above entry
  tp1Pct: number;
  tp2Pct: number;
  tp3Pct: number;
  status: SignalStatus;
  closedAt: number | null;
  closePricePct: number | null;  // % move from entry when closed
  mfePct: number | null;         // max favorable excursion %
  maePct: number | null;         // max adverse excursion %
  expiresAt: number;             // auto-expire after 24h if no TP/SL hit
}

export interface CompareStats {
  source: SignalSource;
  totalSignals: number;
  closedSignals: number;
  winRate: number | null;        // % of closed signals that hit TP1+
  avgScoreOnWins: number | null;
  avgScoreOnLosses: number | null;
  expectancyPct: number | null;  // avg % P&L per closed signal
  byScoreBucket: {
    bucket: string;              // e.g. "60-70", "70-80", "80-85", "85+"
    total: number;
    wins: number;
    winRate: number | null;
  }[];
}

export interface ComparePayload {
  coinbase: CompareStats;
  bitso: CompareStats;
  openSignals: SignalRecord[];
  recentClosed: SignalRecord[];
  fetchedAt: number;
}
